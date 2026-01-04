/**
 * SAUNA SAKURADO スクレイパー
 * URL: https://sauna-sakurado.spa/reservation/
 *
 * 6部屋: 2-A, 2-B, 3-C, 3-D, 3-E, 3-F
 * - 予約可能: bg-amber (黄色/アンバー背景 + 価格表示)
 * - 予約不可: bg-gray (グレー背景)
 */

const URL = 'https://sauna-sakurado.spa/reservation/';

// 部屋名と定員・時間・価格情報（税込価格）
const ROOM_INFO = {
  '2-A': { base: '2-A（140分/定員6名）', capacity: 6, minutes: 140, weekday: 46860, weekend: 49203 },
  '2-B': { base: '2-B（140分/定員6名）', capacity: 6, minutes: 140, weekday: 40900, weekend: 42945 },
  '3-C': { base: '3-C（125分/定員4名）', capacity: 4, minutes: 125, weekday: 17600, weekend: 18480 },
  '3-D': { base: '3-D（125分/定員2名）', capacity: 2, minutes: 125, weekday: 9000, weekend: 9450 },
  '3-E': { base: '3-E（135分/定員6名）', capacity: 6, minutes: 135, weekday: 24750, weekend: 25987 },
  '3-F': { base: '3-F（95分/定員4名）', capacity: 4, minutes: 95, weekday: 15400, weekend: 16170 }
};

// 価格をフォーマット（カンマ区切り）
function formatPrice(price) {
  return '¥' + price.toLocaleString('ja-JP');
}

// 日付が土日祝かどうか判定
function isWeekend(dateStr) {
  const date = new Date(dateStr);
  const day = date.getDay();
  return day === 0 || day === 6; // 0=日曜, 6=土曜
}

// 日付に応じた表示名を生成
function getDisplayName(shortName, dateStr) {
  const info = ROOM_INFO[shortName];
  if (!info) return shortName;
  const price = isWeekend(dateStr) ? info.weekend : info.weekday;
  return `${info.base}${formatPrice(price)}`;
}
const ROOM_NAMES = Object.keys(ROOM_INFO);

async function scrape(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  try {
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 3000));

    const result = { dates: {} };

    // 日付タブを取得
    const dateTabs = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('a'))
        .filter(el => /^\d+\/\d+\([日月火水木金土]\)$/.test(el.textContent.trim()));
      return tabs.map((tab, idx) => ({
        text: tab.textContent.trim(),
        index: idx
      }));
    });

    // 各日付のデータを取得
    for (let i = 0; i < Math.min(dateTabs.length, 7); i++) {
      const tab = dateTabs[i];

      // 日付文字列をYYYY-MM-DD形式に変換
      const match = tab.text.match(/(\d+)\/(\d+)/);
      if (!match) continue;

      const month = match[1].padStart(2, '0');
      const day = match[2].padStart(2, '0');
      const year = new Date().getFullYear();
      const dateStr = `${year}-${month}-${day}`;

      // 日付タブをクリック
      if (i > 0) {
        await page.evaluate((index) => {
          const tabs = Array.from(document.querySelectorAll('a'))
            .filter(el => /^\d+\/\d+\([日月火水木金土]\)$/.test(el.textContent.trim()));
          if (tabs[index]) {
            tabs[index].click();
          }
        }, i);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // 空き状況を取得（列構造を解析）
      const dayData = await page.evaluate((roomNames) => {
        const rooms = {};
        roomNames.forEach(name => { rooms[name] = []; });

        // 各部屋の列ヘッダーの位置を取得
        const roomPositions = [];
        document.querySelectorAll('*').forEach(el => {
          const text = el.textContent.trim();
          // 部屋名で始まる要素を探す（例: "2-A🈳" or "2-A "）
          for (const roomName of roomNames) {
            if (text.startsWith(roomName) && text.length < 30) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 50 && rect.width < 300) {
                // 重複を避けるためX位置をチェック
                const exists = roomPositions.find(p =>
                  p.name === roomName || Math.abs(p.x - rect.x) < 20
                );
                if (!exists) {
                  roomPositions.push({
                    name: roomName,
                    x: rect.x,
                    centerX: rect.x + rect.width / 2
                  });
                }
              }
            }
          }
        });

        // X座標でソート
        roomPositions.sort((a, b) => a.x - b.x);

        // open-modalクラスの要素から時間枠を取得
        document.querySelectorAll('.open-modal').forEach(el => {
          const innerHTML = el.innerHTML;
          const hasAmber = innerHTML.includes('bg-amber');

          // アンバー背景（空き）の場合のみ処理
          if (!hasAmber) return;

          const text = el.textContent;
          // "21:40¥49,20300:00" 形式から開始時間と終了時間を抽出
          const timeMatch = text.match(/(\d{2}:\d{2}).*?(\d{2}:\d{2})/);
          if (!timeMatch) return;

          const time = timeMatch[1] + '〜' + timeMatch[2]; // "21:40〜00:00"
          const rect = el.getBoundingClientRect();
          const elementCenterX = rect.x + rect.width / 2;

          // どの部屋の列に属するか判定
          let closestRoom = null;
          let minDistance = Infinity;

          roomPositions.forEach(room => {
            const distance = Math.abs(elementCenterX - room.centerX);
            if (distance < minDistance) {
              minDistance = distance;
              closestRoom = room.name;
            }
          });

          // 距離が妥当な範囲内なら追加
          if (closestRoom && minDistance < 150) {
            if (!rooms[closestRoom].includes(time)) {
              rooms[closestRoom].push(time);
            }
          }
        });

        // 時間でソート
        Object.keys(rooms).forEach(key => {
          rooms[key].sort();
        });

        return rooms;
      }, ROOM_NAMES);

      // 部屋名を表示名に変換（日付に応じた価格を表示）
      const convertedDayData = {};
      for (const [shortName, slots] of Object.entries(dayData)) {
        const displayName = getDisplayName(shortName, dateStr);
        convertedDayData[displayName] = slots;
      }
      result.dates[dateStr] = convertedDayData;
    }

    return result;
  } finally {
    await page.close();
  }
}

module.exports = { scrape };
