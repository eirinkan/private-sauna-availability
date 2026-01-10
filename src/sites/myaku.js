/**
 * 脈 -MYAKU PRIVATE SAUNA- (spot-ly) スクレイパー
 * URL: https://spot-ly.jp/ja/hotels/176
 *
 * 現在は日単位の空き状況（○/×）を取得
 *
 * TODO: 詳細時間帯取得の実装
 * - 大人ドロップダウンで「1名」を選択
 * - 「予約する」ボタンをクリック → モーダル表示
 * - モーダル内の時間帯ボタンのdisabled属性で空き/埋まりを判定
 */

const BASE_URL = 'https://spot-ly.jp/ja/hotels/176';

// プラン情報
const PLANS = [
  {
    name: '休 KYU（90分/定員3名）¥9,130〜',
    planTitle: '【休 -KYU-】90分プラン（午後）',
    timeSlots: ['11:30〜13:00', '13:30〜15:00', '15:30〜17:00', '17:30〜19:00', '19:30〜21:00'],
    isNight: false
  },
  {
    name: '水 MIZU（night/定員2名）¥8,800〜',
    planTitle: '【水 -MIZU-】ナイトパック',
    timeSlots: ['1:00〜8:30'],
    isNight: true
  },
  {
    name: '水 MIZU（90分午後/定員2名）¥6,600〜',
    planTitle: '【水 -MIZU-】90分プラン（午後）',
    timeSlots: ['13:00〜14:30', '15:00〜16:30', '17:00〜18:30', '19:00〜20:30', '21:00〜22:30', '23:00〜0:30'],
    isNight: false
  },
  {
    name: '水 MIZU（90分午前/定員2名）¥6,600〜',
    planTitle: '【水 -MIZU-】90分プラン（午前）',
    timeSlots: ['9:00〜10:30', '11:00〜12:30'],
    isNight: false
  },
  {
    name: '火 HI（night/定員4名）¥10,120〜',
    planTitle: '【火 -HI-】ナイトパック',
    timeSlots: ['0:30〜8:00'],
    isNight: true
  },
  {
    name: '火 HI（90分午後/定員4名）¥7,150〜',
    planTitle: '【火 -HI-】90分プラン（午後）',
    timeSlots: ['14:30〜16:00', '16:30〜18:00', '18:30〜20:00', '20:30〜22:00', '22:30〜0:00'],
    isNight: false
  },
  {
    name: '火 HI（90分午前/定員4名）¥7,150〜',
    planTitle: '【火 -HI-】90分プラン（午前）',
    timeSlots: ['8:30〜10:00', '10:30〜12:00', '12:30〜14:00'],
    isNight: false
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

    // ページ全体をスクロールしてコンテンツを読み込む
    await page.evaluate(() => window.scrollTo(0, 3000));
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 各プランのカレンダーから○/×を取得
    const planAvailability = await page.evaluate((plans) => {
      const results = {};
      const fullText = document.body.innerText;

      for (const plan of plans) {
        results[plan.planTitle] = { availableDates: [] };

        // プランタイトルの位置を見つける
        const titleIndex = fullText.indexOf(plan.planTitle);
        if (titleIndex === -1) continue;

        // プランタイトルの後の部分を取得（次のプランまで、または1500文字）
        let nextPlanIndex = fullText.length;
        for (const otherPlan of plans) {
          if (otherPlan.planTitle === plan.planTitle) continue;
          const idx = fullText.indexOf(otherPlan.planTitle, titleIndex + 1);
          if (idx !== -1 && idx < nextPlanIndex) {
            nextPlanIndex = idx;
          }
        }

        const sectionText = fullText.substring(titleIndex, Math.min(nextPlanIndex, titleIndex + 1500));

        // 日付パターン: 1/11\n◯ or 1/11\n✕ (日付と記号が別行)
        const calendarPattern = /(\d{1,2})\/(\d{1,2})\n([○◯×✕])/g;
        let match;

        while ((match = calendarPattern.exec(sectionText)) !== null) {
          const month = parseInt(match[1]);
          const day = parseInt(match[2]);
          const status = match[3];

          // ○の場合のみ空きありとして記録
          if (status === '○' || status === '◯') {
            // 重複チェック
            const exists = results[plan.planTitle].availableDates.some(
              d => d.month === month && d.day === day
            );
            if (!exists) {
              results[plan.planTitle].availableDates.push({ month, day });
            }
          }
        }
      }

      return results;
    }, PLANS);

    // 結果を処理
    for (const plan of PLANS) {
      const availability = planAvailability[plan.planTitle];
      if (!availability || !availability.availableDates) continue;

      console.log(`    → ${plan.planTitle}: ${availability.availableDates.length}日分`);

      for (const dateInfo of availability.availableDates) {
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

        // 全時間帯を「空き枠あり」として記録
        // TODO: 詳細時間帯取得を実装後、実際の空き時間帯に置き換える
        for (const slot of plan.timeSlots) {
          if (!result.dates[dateStr][plan.name].includes(slot)) {
            result.dates[dateStr][plan.name].push(slot);
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
