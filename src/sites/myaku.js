/**
 * 脈 -MYAKU PRIVATE SAUNA- (spot-ly) スクレイパー
 * URL: https://spot-ly.jp/ja/hotels/176
 *
 * 3部屋:
 * - 休 KYU (3名): 90分プラン（午後）¥9,130〜
 * - 水 MIZU (2名): ナイトパック ¥8,800〜、90分（午前/午後）¥6,600〜
 * - 火 HI (4名): ナイトパック ¥10,120〜、90分（午前/午後）¥7,150〜
 *
 * 構造: 週間カレンダー形式（◯/✕で日単位の空き表示）
 */

// 1週間分のURLを生成
function getUrl() {
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + 6);

  const formatDate = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}+00%3A00%3A00`;
  };

  return `https://spot-ly.jp/ja/hotels/176?checkinDatetime=${formatDate(today)}&checkoutDatetime=${formatDate(endDate)}`;
}

// 部屋情報（通常価格とナイト価格を分離）
const ROOM_INFO = {
  '休 -KYU-': {
    displayName: '休 KYU（90分/定員3名）¥9,130〜',
    capacity: 3,
    plans: {
      '90分プラン（午後）': { times: ['11:30〜13:00', '13:30〜15:00', '15:30〜17:00', '17:30〜19:00', '19:30〜21:00'] }
    }
  },
  '水 -MIZU-': {
    displayName: '水 MIZU（90分/定員2名）¥6,600〜',
    nightDisplayName: '水 MIZU（night/定員2名）¥8,800〜',
    capacity: 2,
    plans: {
      'ナイトパック': { times: ['01:00〜08:30'], isNight: true },
      '90分プラン（午後）': { times: ['13:00〜14:30', '15:00〜16:30', '17:00〜18:30', '19:00〜20:30', '21:00〜22:30', '23:00〜00:30'] },
      '90分プラン（午前）': { times: ['09:00〜10:30', '11:00〜12:30'] }
    }
  },
  '火 -HI-': {
    displayName: '火 HI（90分/定員4名）¥7,150〜',
    nightDisplayName: '火 HI（night/定員4名）¥10,120〜',
    capacity: 4,
    plans: {
      'ナイトパック': { times: ['00:30〜08:00'], isNight: true },
      '90分プラン（午後）': { times: ['14:30〜16:00', '16:30〜18:00', '18:30〜20:00', '20:30〜22:00', '22:30〜00:00'] },
      '90分プラン（午前）': { times: ['08:30〜10:00', '10:30〜12:00', '12:30〜14:00'] }
    }
  }
};

// 休 KYU 宿泊プランリンク
const KYU_STAY_URL = 'https://hotel.travel.rakuten.co.jp/hotelinfo/plan/?f_no=191639&f_flg=PLAN';

async function scrape(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 900 });

  try {
    const url = getUrl();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // ページ下部までスクロールしてコンテンツをロード
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 空室カレンダーがレンダリングされるまで待機（◯または✕が表示されるまで）
    await page.waitForFunction(
      () => document.body.innerText.includes('月\n火\n水\n木\n金\n土\n日\n'),
      { timeout: 30000 }
    ).catch(() => {});

    await new Promise(resolve => setTimeout(resolve, 3000));

    // ページからプランデータを抽出
    const plansData = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      const plans = [];

      // 週範囲を取得 (例: "1/05 (月) 〜 1/11 (日)")
      const weekMatch = bodyText.match(/(\d{1,2})\/(\d{2})\s*\([月火水木金土日]\)\s*[〜~]\s*(\d{1,2})\/(\d{2})/);
      if (!weekMatch) return plans;

      const year = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;

      // 各プランセクションを検索（大人\nで終了するパターン）
      const planPatterns = [
        { room: '休 -KYU-', plan: '90分プラン（午後）', regex: /【休\s*-KYU-】90分プラン（午後）[\s\S]*?月\n火\n水\n木\n金\n土\n日\n([\s\S]*?)\n大人/ },
        { room: '水 -MIZU-', plan: 'ナイトパック', regex: /【水\s*-MIZU-】ナイトパック[\s\S]*?月\n火\n水\n木\n金\n土\n日\n([\s\S]*?)\n大人/ },
        { room: '水 -MIZU-', plan: '90分プラン（午後）', regex: /【水\s*-MIZU-】90分プラン（午後）[\s\S]*?月\n火\n水\n木\n金\n土\n日\n([\s\S]*?)\n大人/ },
        { room: '水 -MIZU-', plan: '90分プラン（午前）', regex: /【水\s*-MIZU-】90分プラン（午前）[\s\S]*?月\n火\n水\n木\n金\n土\n日\n([\s\S]*?)\n大人/ },
        { room: '火 -HI-', plan: 'ナイトパック', regex: /【火\s*-HI-】ナイトパック[\s\S]*?月\n火\n水\n木\n金\n土\n日\n([\s\S]*?)\n大人/ },
        { room: '火 -HI-', plan: '90分プラン（午後）', regex: /【火\s*-HI-】90分プラン（午後）[\s\S]*?月\n火\n水\n木\n金\n土\n日\n([\s\S]*?)\n大人/ },
        { room: '火 -HI-', plan: '90分プラン（午前）', regex: /【火\s*-HI-】90分プラン（午前）[\s\S]*?月\n火\n水\n木\n金\n土\n日\n([\s\S]*?)\n大人/ }
      ];

      for (const pattern of planPatterns) {
        const match = bodyText.match(pattern.regex);
        if (match) {
          // カレンダーデータを解析 (例: "1/5\n◯\n1/6\n◯\n...")
          const calendarText = match[1];
          const dateAvailPairs = calendarText.trim().split('\n');

          const dates = [];
          for (let i = 0; i < dateAvailPairs.length - 1; i += 2) {
            const dateStr = dateAvailPairs[i];
            const avail = dateAvailPairs[i + 1];

            const dateMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})/);
            if (dateMatch) {
              let month = parseInt(dateMatch[1]);
              let day = parseInt(dateMatch[2]);
              let dateYear = year;

              // 1月で現在が12月なら来年
              if (month === 1 && currentMonth === 12) {
                dateYear = year + 1;
              }

              dates.push({
                date: `${month}/${day}`,
                fullDate: `${dateYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
                available: avail === '◯'
              });
            }
          }

          plans.push({
            room: pattern.room,
            planType: pattern.plan,
            dates: dates
          });
        }
      }

      return plans;
    });

    // 結果を整形
    const result = { dates: {} };
    const currentYear = new Date().getFullYear();

    for (const plan of plansData) {
      const roomInfo = ROOM_INFO[plan.room];
      if (!roomInfo) continue;

      const planInfo = roomInfo.plans[plan.planType];
      if (!planInfo) continue;

      // 部屋名を決定（ナイトパックは別価格）
      let displayName = planInfo.isNight && roomInfo.nightDisplayName
        ? roomInfo.nightDisplayName
        : roomInfo.displayName;

      for (const dateInfo of plan.dates) {
        let dateStr = dateInfo.fullDate;

        // ナイトパックの場合、日付を1日前にする（前日夜から翌朝のため）
        // 例: 1/6の01:00〜08:30は、1/5の夜に開始するので1/5の空きとして表示
        if (planInfo.isNight) {
          const d = new Date(dateStr);
          d.setDate(d.getDate() - 1);
          dateStr = d.toISOString().split('T')[0];
        }

        if (!result.dates[dateStr]) {
          result.dates[dateStr] = {};
        }

        // 空きがある日は時間枠を設定、なければ空配列
        if (dateInfo.available) {
          // 同じ部屋の複数プランをマージ
          if (!result.dates[dateStr][displayName]) {
            result.dates[dateStr][displayName] = [];
          }
          // 時間枠を追加（重複排除）
          for (const time of planInfo.times) {
            if (!result.dates[dateStr][displayName].includes(time)) {
              result.dates[dateStr][displayName].push(time);
            }
          }
        } else {
          // 空きなしの場合も部屋は表示（空配列）
          if (!result.dates[dateStr][displayName]) {
            result.dates[dateStr][displayName] = [];
          }
        }
      }
    }

    // 時間枠をソート
    for (const dateStr of Object.keys(result.dates)) {
      for (const roomName of Object.keys(result.dates[dateStr])) {
        result.dates[dateStr][roomName].sort((a, b) => {
          const aStart = a.split('〜')[0];
          const bStart = b.split('〜')[0];
          const [aH, aM] = aStart.split(':').map(Number);
          const [bH, bM] = bStart.split(':').map(Number);
          // 深夜帯（0-6時）は24時以降として扱う
          const aHour = aH < 7 ? aH + 24 : aH;
          const bHour = bH < 7 ? bH + 24 : bH;
          return (aHour * 60 + aM) - (bHour * 60 + bM);
        });
      }
    }

    return result;
  } finally {
    await page.close();
  }
}

module.exports = { scrape };
