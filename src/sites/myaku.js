/**
 * 脈 -MYAKU PRIVATE SAUNA- (spot-ly) スクレイパー
 * URL: https://spot-ly.jp/ja/hotels/176
 *
 * 3部屋・7プラン:
 * - 休 KYU: 90分プラン（午後）
 * - 水 MIZU: ナイトパック、90分プラン（午後）、90分プラン（午前）
 * - 火 HI: ナイトパック、90分プラン（午後）、90分プラン（午前）
 *
 * 実装: 日付要素の親テキストから「1/10◯」形式で空き状況を取得
 */

const BASE_URL = 'https://spot-ly.jp/ja/hotels/176';

// プラン情報（ページに表示される順番）
const PLANS = [
  { name: '休 KYU（90分/定員3名）¥9,130〜', isNight: false },
  { name: '水 MIZU（night/定員2名）¥8,800〜', isNight: true },
  { name: '水 MIZU（90分午後/定員2名）¥6,600〜', isNight: false },
  { name: '水 MIZU（90分午前/定員2名）¥6,600〜', isNight: false },
  { name: '火 HI（night/定員4名）¥10,120〜', isNight: true },
  { name: '火 HI（90分午後/定員4名）¥7,150〜', isNight: false },
  { name: '火 HI（90分午前/定員4名）¥7,150〜', isNight: false }
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

    // ページから全ての日付セルを取得
    const calendarData = await page.evaluate((currentYear, currentMonth) => {
      const pairs = [];
      const els = document.querySelectorAll('*');

      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        const text = el.textContent.trim();

        // 日付パターン（1/9, 1/10など）を持つ要素を探す
        if (text.indexOf('/') > 0 && text.length <= 4 && el.children.length === 0) {
          const match = text.match(/^(\d{1,2})\/(\d{1,2})$/);
          if (match) {
            const parent = el.parentElement;
            if (parent) {
              const parentText = parent.textContent.trim();
              // 親テキストから◯/✕を判定
              const isAvailable = parentText.includes('◯') || parentText.includes('○');
              pairs.push({
                month: parseInt(match[1]),
                day: parseInt(match[2]),
                available: isAvailable
              });
            }
          }
        }
      }

      return pairs;
    }, currentYear, currentMonth);

    // 7プラン × 7日 = 49エントリを期待
    const daysPerPlan = 7;

    for (let planIdx = 0; planIdx < PLANS.length; planIdx++) {
      const plan = PLANS[planIdx];
      const startIdx = planIdx * daysPerPlan;
      const planDates = calendarData.slice(startIdx, startIdx + daysPerPlan);

      for (const dateInfo of planDates) {
        if (!dateInfo.available) continue;

        // 年を判定
        let year = currentYear;
        if (dateInfo.month < currentMonth) {
          year = currentYear + 1;
        }

        let dateStr = `${year}-${String(dateInfo.month).padStart(2, '0')}-${String(dateInfo.day).padStart(2, '0')}`;

        // ナイトプランは前日として表示
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

        // 詳細時間は予約サイトで確認
        if (!result.dates[dateStr][plan.name].includes('空き枠あり')) {
          result.dates[dateStr][plan.name].push('空き枠あり');
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
