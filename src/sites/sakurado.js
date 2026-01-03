/**
 * SAUNA SAKURADO スクレイパー
 * URL: https://sauna-sakurado.spa/reservation/
 *
 * 6部屋: 2-A, 2-B, 3-C, 3-D, 3-E, 3-F
 * - 予約可能: bg-amber-100/90 (黄色/アンバー)
 * - 予約不可: bg-gray-100/90 (グレー)
 */

const URL = 'https://sauna-sakurado.spa/reservation/';

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
      const tabs = Array.from(document.querySelectorAll('a.ff-EN'))
        .filter(el => /^\d+\/\d+\([日月火水木金土]\)$/.test(el.textContent.trim()));

      return tabs.map(tab => ({
        text: tab.textContent.trim(),
        href: tab.getAttribute('href') || '',
        isActive: tab.className.includes('bg-primary')
      }));
    });

    // 各日付のデータを取得
    for (let i = 0; i < dateTabs.length; i++) {
      const tab = dateTabs[i];

      // 日付文字列をYYYY-MM-DD形式に変換
      const match = tab.text.match(/(\d+)\/(\d+)/);
      if (!match) continue;

      const month = match[1].padStart(2, '0');
      const day = match[2].padStart(2, '0');
      const year = new Date().getFullYear();
      const dateStr = `${year}-${month}-${day}`;

      // アクティブでない場合はクリックして切り替え
      if (i > 0) {
        const clicked = await page.evaluate((index) => {
          const tabs = Array.from(document.querySelectorAll('a.ff-EN'))
            .filter(el => /^\d+\/\d+\([日月火水木金土]\)$/.test(el.textContent.trim()));

          if (tabs[index]) {
            tabs[index].click();
            return true;
          }
          return false;
        }, i);

        if (clicked) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // その日の空き状況を取得
      const dayData = await page.evaluate(() => {
        const rooms = {};
        const roomNames = ['2-A', '2-B', '3-C', '3-D', '3-E', '3-F'];

        // ページ全体のテキストから部屋ごとの情報を抽出
        const allElements = Array.from(document.querySelectorAll('*'));

        // 時間枠を持つ親要素を探す
        const timeSlotContainers = Array.from(document.querySelectorAll('.open-modal'))
          .filter(el => {
            const text = el.textContent;
            return /\d{2}:\d{2}/.test(text) && /¥[\d,]+/.test(text);
          });

        // 予約可能な枠を探す（amber = 予約可能）
        const availableSlots = Array.from(document.querySelectorAll('[class*="bg-amber"]'))
          .filter(el => /¥[\d,]+/.test(el.textContent));

        // 親コンテナから時間情報を取得
        availableSlots.forEach(slot => {
          const parent = slot.closest('.open-modal');
          if (parent) {
            const times = parent.textContent.match(/\d{2}:\d{2}/g);
            if (times && times.length >= 1) {
              const startTime = times[0];
              // どの部屋か特定（列の位置から推定）
              // 簡易的に、slot要素の位置情報から推定
            }
          }
        });

        // より詳細な解析: グリッド構造を利用
        const gridItems = Array.from(document.querySelectorAll('[class*="grid"] > div, [class*="flex"] > div'));

        // 各部屋ごとに空き時間を初期化
        roomNames.forEach(name => {
          rooms[name] = [];
        });

        // open-modalクラスを持つボタンから情報を抽出
        const buttons = Array.from(document.querySelectorAll('button.open-modal, a.open-modal, div.open-modal'));

        buttons.forEach((btn, index) => {
          const times = btn.textContent.match(/\d{2}:\d{2}/g);
          const price = btn.querySelector('[class*="bg-amber"]');

          if (times && times.length >= 1 && price) {
            const startTime = times[0];
            // 部屋のインデックスを推定（6部屋×時間枠数で割り当て）
            const roomIndex = index % 6;
            if (roomIndex < roomNames.length) {
              rooms[roomNames[roomIndex]].push(startTime);
            }
          }
        });

        return rooms;
      });

      result.dates[dateStr] = dayData;
    }

    return result;
  } finally {
    await page.close();
  }
}

module.exports = { scrape };
