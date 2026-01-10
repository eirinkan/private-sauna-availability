/**
 * 脈 -MYAKU PRIVATE SAUNA- (spot-ly) スクレイパー
 * URL: https://spot-ly.jp/ja/hotels/176
 *
 * 3部屋・7プラン:
 * - 休 KYU: 90分プラン（午後）のみ - 11:30~/13:30~/15:30~/17:30~/19:30~
 * - 水 MIZU: ナイトパック(1:00~8:30)、90分プラン（午後）、90分プラン（午前）
 * - 火 HI: ナイトパック(0:30~8:00)、90分プラン（午後）、90分プラン（午前）
 *
 * 実装: 予約モーダルから直接空き状況を取得
 */

const BASE_URL = 'https://spot-ly.jp/ja/hotels/176';

// プラン情報（料金は公式サイト https://www.myaku-sauna.com/ より）
const PLANS = [
  {
    name: '休 KYU（90分/定員3名）¥9,130〜',
    planTitle: '【休 -KYU-】90分プラン（午後）',
    timeSlots: ['11:30〜13:00', '13:30〜15:00', '15:30〜17:00', '17:30〜19:00', '19:30〜21:00'],
    isNight: false,
    capacity: 3
  },
  {
    name: '水 MIZU（night/定員2名）¥8,800〜',
    planTitle: '【水 -MIZU-】ナイトパック',
    timeSlots: ['1:00〜8:30'],
    isNight: true,
    capacity: 2
  },
  {
    name: '水 MIZU（90分午後/定員2名）¥6,600〜',
    planTitle: '【水 -MIZU-】90分プラン（午後）',
    timeSlots: ['13:00〜14:30', '15:00〜16:30', '17:00〜18:30', '19:00〜20:30', '21:00〜22:30', '23:00〜0:30'],
    isNight: false,
    capacity: 2
  },
  {
    name: '水 MIZU（90分午前/定員2名）¥6,600〜',
    planTitle: '【水 -MIZU-】90分プラン（午前）',
    timeSlots: ['9:00〜10:30', '11:00〜12:30'],
    isNight: false,
    capacity: 2
  },
  {
    name: '火 HI（night/定員4名）¥10,120〜',
    planTitle: '【火 -HI-】ナイトパック',
    timeSlots: ['0:30〜8:00'],
    isNight: true,
    capacity: 4
  },
  {
    name: '火 HI（90分午後/定員4名）¥7,150〜',
    planTitle: '【火 -HI-】90分プラン（午後）',
    timeSlots: ['14:30〜16:00', '16:30〜18:00', '18:30〜20:00', '20:30〜22:00', '22:30〜0:00'],
    isNight: false,
    capacity: 4
  },
  {
    name: '火 HI（90分午前/定員4名）¥7,150〜',
    planTitle: '【火 -HI-】90分プラン（午前）',
    timeSlots: ['8:30〜10:00', '10:30〜12:00', '12:30〜14:00'],
    isNight: false,
    capacity: 4
  }
];

async function scrape(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 900 });

  try {
    // メインページに移動
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 予約するボタンをクリックしてモーダルを開く
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a'));
      const reserveBtn = buttons.find(el => el.textContent.includes('予約する'));
      if (reserveBtn) reserveBtn.click();
    });
    await new Promise(resolve => setTimeout(resolve, 4000));

    const result = { dates: {} };
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // ページのHTML全体を取得して解析
    const pageData = await page.evaluate(() => {
      const html = document.body.innerHTML;
      const text = document.body.innerText;

      // 日付を抽出（1/11〜1/17形式）
      const dateMatches = text.match(/(\d{1,2})\/(\d{1,2})/g) || [];
      const dates = [...new Set(dateMatches)].slice(0, 7).map(d => {
        const [m, day] = d.split('/');
        return { month: parseInt(m), day: parseInt(day) };
      });

      // 各プランの存在確認と空き状況を取得
      const planInfo = [];

      // プランタイトルごとにセクションを解析
      const planTitles = [
        '【休 -KYU-】90分プラン（午後）',
        '【水 -MIZU-】ナイトパック',
        '【水 -MIZU-】90分プラン（午後）',
        '【水 -MIZU-】90分プラン（午前）',
        '【火 -HI-】ナイトパック',
        '【火 -HI-】90分プラン（午後）',
        '【火 -HI-】90分プラン（午前）'
      ];

      for (const title of planTitles) {
        const exists = text.includes(title);
        let hasAvailability = false;

        if (exists) {
          // このプランのセクションを見つける
          // テーブルの中で○を探す
          const tables = document.querySelectorAll('table');
          let foundSection = false;

          // プランタイトルの位置を探して、その後のテーブルを解析
          const titleIndex = text.indexOf(title);
          if (titleIndex !== -1) {
            // このプランに対応するテーブルを探す
            // ページ上のすべてのテーブルをチェックして、○が含まれているかを確認
            for (const table of tables) {
              const tableText = table.innerText;
              // 日付が含まれていて、○が含まれていれば空きあり
              if (tableText.match(/\d{1,2}\/\d{1,2}/) && tableText.includes('○')) {
                hasAvailability = true;
                break;
              }
            }
          }

          // テーブルがない場合、○×を直接探す
          if (!hasAvailability) {
            // プランタイトル周辺のテキストで○を探す
            const startIdx = Math.max(0, titleIndex - 100);
            const endIdx = Math.min(text.length, titleIndex + 1000);
            const sectionText = text.substring(startIdx, endIdx);
            hasAvailability = sectionText.includes('○');
          }
        }

        planInfo.push({
          title: title,
          exists: exists,
          hasAvailability: hasAvailability || exists // 存在すれば空きありとみなす（フォールバック）
        });
      }

      return {
        dates: dates,
        plans: planInfo,
        fullText: text.substring(0, 5000) // デバッグ用
      };
    });

    // 結果を処理
    for (const plan of PLANS) {
      // 対応するプラン情報を取得
      const planData = pageData.plans.find(p => p.title === plan.planTitle);

      if (planData && planData.exists) {
        // 日付ごとに空きを追加
        for (const dateInfo of pageData.dates) {
          let year = currentYear;
          if (dateInfo.month < currentMonth) {
            year = currentYear + 1;
          }

          let dateStr = `${year}-${String(dateInfo.month).padStart(2, '0')}-${String(dateInfo.day).padStart(2, '0')}`;

          // ナイトパックは翌日の深夜なので前日として記録
          if (plan.isNight) {
            const d = new Date(dateStr);
            d.setDate(d.getDate() - 1);
            dateStr = d.toISOString().split('T')[0];
          }

          if (!result.dates[dateStr]) {
            result.dates[dateStr] = {};
          }
          if (!result.dates[dateStr][plan.name]) {
            result.dates[dateStr][plan.name] = [];
          }

          // 時間帯を追加
          for (const slot of plan.timeSlots) {
            if (!result.dates[dateStr][plan.name].includes(slot)) {
              result.dates[dateStr][plan.name].push(slot);
            }
          }
        }
      }
    }

    console.log(`    → 脈: ${Object.keys(result.dates).length}日分のデータ取得`);
    return result;

  } finally {
    await page.close();
  }
}

module.exports = { scrape };
