/**
 * GIRAFFE南天神 (RESERVA) スクレイパー
 * 4つの部屋URL
 */

const URLS = [
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=88eJwzNDAyszACAAQoATQ&ctg_no=05eJwzMjQ2NgIAAvQA_A',
    defaultName: 'Room 1'
  },
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=91eJwzNDAyszAGAAQpATU&ctg_no=05eJwzMjQ2NgIAAvQA_A',
    defaultName: 'Room 2'
  },
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=72eJyzNDcztgQAAz8BEw&ctg_no=5aeJwzMjQyMAQAAuoA9w',
    defaultName: 'Room 3'
  },
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=4feJyzNLcwMAIAAzgBCw&ctg_no=5aeJwzMjQyMAQAAuoA9w',
    defaultName: 'Room 4'
  }
];

async function scrape(browser) {
  const result = { dates: {} };

  for (const room of URLS) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    try {
      await page.goto(room.url, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(resolve => setTimeout(resolve, 3000));

      const roomData = await page.evaluate((defaultName) => {
        // 部屋名を取得
        const titleEl = document.querySelector('h3.menu-detail__title');
        const roomName = titleEl ? titleEl.textContent.trim() : defaultName;

        // カレンダーの日付と空き状況を取得
        const dates = {};

        // 予約可能な日付を探す
        const calendarDays = document.querySelectorAll('.date, [class*="calendar"] td, [class*="day"]');
        const availableDays = document.querySelectorAll('[class*="available"], [class*="reserve"]');

        // ページ内のテキストから日付情報を抽出
        const bodyText = document.body.innerText;

        // 月情報を取得
        const monthMatch = bodyText.match(/(\d{4})年(\d{1,2})月/);
        const year = monthMatch ? monthMatch[1] : new Date().getFullYear();
        const month = monthMatch ? monthMatch[2].padStart(2, '0') : (new Date().getMonth() + 1).toString().padStart(2, '0');

        // 時間枠を探す
        const timeElements = Array.from(document.querySelectorAll('*'))
          .filter(el => {
            const text = el.textContent.trim();
            return /^\d{1,2}:\d{2}$/.test(text) || /^\d{1,2}時/.test(text);
          })
          .map(el => el.textContent.trim());

        // 予約ボタンの有無で空きを判定
        const hasAvailability = document.querySelector('[class*="reserve"], button[class*="available"]') !== null;

        return {
          roomName,
          year,
          month,
          timeSlots: [...new Set(timeElements)],
          hasAvailability,
          rawText: bodyText.substring(0, 2000)
        };
      }, room.defaultName);

      // 部屋データを結果に追加
      const roomName = roomData.roomName;

      // 簡易的に今日から7日間のデータを作成（実際の空きは要調整）
      const today = new Date();
      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];

        if (!result.dates[dateStr]) {
          result.dates[dateStr] = {};
        }

        // 時間枠があれば追加（実際の空き判定は要調整）
        result.dates[dateStr][roomName] = roomData.hasAvailability ? roomData.timeSlots : [];
      }

    } catch (error) {
      console.error(`GIRAFFE ${room.defaultName} エラー:`, error.message);
    } finally {
      await page.close();
    }
  }

  return result;
}

module.exports = { scrape };
