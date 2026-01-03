/**
 * BASE Private sauna (Coubic) スクレイパー
 * URL: https://coubic.com/base-private-sauna
 *
 * 5部屋、60分〜150分コース
 * カレンダーページで空き確認
 */

const URL = 'https://coubic.com/base-private-sauna';

async function scrape(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  try {
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // カレンダーページへ遷移
    const calendarClicked = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      for (const link of links) {
        if (link.textContent.includes('カレンダー') || link.href?.includes('calendar')) {
          link.click();
          return true;
        }
      }
      return false;
    });

    if (calendarClicked) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    const result = { dates: {} };

    // カレンダーから空き情報を取得
    const calendarData = await page.evaluate(() => {
      const data = {};
      const year = new Date().getFullYear();

      // カレンダーの日付セルを探す
      const dayCells = document.querySelectorAll('[class*="day"], [class*="date"], td');

      // 予約可能な枠を探す
      const availableSlots = Array.from(document.querySelectorAll('[class*="available"], [class*="open"], a[href*="reserve"]'))
        .filter(el => {
          const text = el.textContent;
          return /\d{1,2}:\d{2}/.test(text) || /空き/.test(text);
        });

      // 時間枠を抽出
      const times = [];
      const timeElements = document.querySelectorAll('*');
      for (const el of timeElements) {
        const text = el.textContent.trim();
        if (/^\d{1,2}:\d{2}$/.test(text)) {
          times.push(text);
        }
      }

      // ページテキストから情報を抽出
      const bodyText = document.body.innerText;

      // 日付パターンを検索
      const dateMatches = bodyText.match(/(\d{1,2})月(\d{1,2})日/g) || [];
      const dates = dateMatches.map(m => {
        const match = m.match(/(\d{1,2})月(\d{1,2})日/);
        if (match) {
          const month = match[1].padStart(2, '0');
          const day = match[2].padStart(2, '0');
          return `${year}-${month}-${day}`;
        }
        return null;
      }).filter(Boolean);

      return {
        dates,
        times: [...new Set(times)],
        availableCount: availableSlots.length,
        bodyText: bodyText.substring(0, 3000)
      };
    });

    // 結果を構築
    const today = new Date();
    const courses = ['80分コース', '100分コース', '150分コース'];

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];

      result.dates[dateStr] = {};
      for (const course of courses) {
        // 簡易的にデータを設定（詳細は要調整）
        result.dates[dateStr][course] = calendarData.times.slice(0, 6);
      }
    }

    return result;
  } finally {
    await page.close();
  }
}

module.exports = { scrape };
