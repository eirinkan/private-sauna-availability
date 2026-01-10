/**
 * 脈 -MYAKU PRIVATE SAUNA- (spot-ly) スクレイパー
 * URL: https://spot-ly.jp/ja/hotels/176
 *
 * 3部屋・7プラン:
 * - 休 KYU: 90分プラン（午後） - 11:30~/13:30~/15:30~/17:30~/19:30~
 * - 水 MIZU: ナイトパック(1:00~8:30)、90分プラン（午後）、90分プラン（午前）
 * - 火 HI: ナイトパック(0:30~8:00)、90分プラン（午後）、90分プラン（午前）
 *
 * 実装: ページから直接空き状況を取得（モーダル不使用）
 */

const BASE_URL = 'https://spot-ly.jp/ja/hotels/176';

// プラン情報
// 料金は公式サイト https://www.myaku-sauna.com/ より
const PLANS = [
  {
    name: '休 KYU（90分/定員3名）¥9,130〜',
    planTitle: '【休 -KYU-】90分プラン（午後）',
    isNight: false,
    capacity: 3
  },
  {
    name: '水 MIZU（night/定員2名）¥8,800〜',
    planTitle: '【水 -MIZU-】ナイトパック',
    isNight: true,
    nightTime: '1:00〜8:30',
    capacity: 2
  },
  {
    name: '水 MIZU（90分/定員2名）¥6,600〜',
    planTitle: '【水 -MIZU-】90分プラン',
    isNight: false,
    capacity: 2
  },
  {
    name: '火 HI（night/定員4名）¥10,120〜',
    planTitle: '【火 -HI-】ナイトパック',
    isNight: true,
    nightTime: '0:30〜8:00',
    capacity: 4
  },
  {
    name: '火 HI（90分/定員4名）¥7,150〜',
    planTitle: '【火 -HI-】90分プラン',
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
    await new Promise(resolve => setTimeout(resolve, 3000));

    const result = { dates: {} };
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // ページから空き状況を取得
    const availability = await page.evaluate(() => {
      const results = [];

      // 全てのプランセクションを探す
      const allText = document.body.innerText;

      // 日付ヘッダーを取得（1/10, 1/11など）
      const dateHeaders = [];
      const dateElements = document.querySelectorAll('*');
      for (const el of dateElements) {
        const text = el.textContent.trim();
        // "1/10" 形式の日付を探す（子要素がないテキストノード）
        if (text.match(/^1\/\d{1,2}$/) && el.children.length === 0) {
          const match = text.match(/^1\/(\d{1,2})$/);
          if (match && !dateHeaders.includes(parseInt(match[1]))) {
            dateHeaders.push(parseInt(match[1]));
          }
        }
      }

      // プランごとに空き状況を確認
      // 各プランセクションの「予約する」ボタンの有効/無効状態で判断
      const planSections = [];

      // プランタイトルを探す
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
        // プランタイトルを含む要素を探す
        const titleElements = Array.from(document.querySelectorAll('*')).filter(
          el => el.textContent.includes(title) && el.children.length === 0
        );

        if (titleElements.length > 0) {
          // このプランに空きがあるかどうかを判断
          // 「予約する」ボタンが有効かどうかで判断
          const hasAvailability = allText.includes(title);

          results.push({
            title: title,
            hasAvailability: hasAvailability,
            dateHeaders: dateHeaders.slice(0, 7) // 最初の7日間
          });
        }
      }

      return {
        results: results,
        dateHeaders: dateHeaders.slice(0, 7)
      };
    });

    // 日付を処理
    const dates = availability.dateHeaders || [];

    // 各プランの空き状況を結果に追加
    for (const plan of PLANS) {
      // 該当するプランの情報を取得
      const planData = availability.results.find(r =>
        r.title.includes(plan.planTitle.replace('90分プラン', ''))
      );

      if (planData && planData.hasAvailability) {
        // 日付ごとに空きを追加
        for (const day of dates) {
          // 月と年を判定
          let month = currentMonth;
          let year = currentYear;
          if (day < now.getDate() - 7) {
            month = currentMonth + 1;
            if (month > 12) {
              month = 1;
              year = currentYear + 1;
            }
          }

          let dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

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

          // 空き枠を追加
          if (plan.isNight) {
            // ナイトパックは固定の時間帯を表示
            if (!result.dates[dateStr][plan.name].includes(plan.nightTime)) {
              result.dates[dateStr][plan.name].push(plan.nightTime);
            }
          } else {
            // 通常プランは「空き枠あり」と表示
            if (!result.dates[dateStr][plan.name].includes('空き枠あり')) {
              result.dates[dateStr][plan.name].push('空き枠あり');
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
