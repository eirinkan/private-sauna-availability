/**
 * SAUNA OOO FUKUOKA (gflow) スクレイパー
 * URL: https://sw.gflow.cloud/ooo-fukuoka/calendar_open
 *
 * 3部屋: サンカク(2名), マル(4名), シカク(6名)
 * テーブル形式: 横=日付、縦=時間枠
 * 空き=価格表示、空きなし=空欄
 */

const URL = 'https://sw.gflow.cloud/ooo-fukuoka/calendar_open';

async function scrape(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  try {
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 5000));

    const result = { dates: {} };

    // 3つの部屋を順番に取得
    const rooms = ['サンカクの部屋', 'マルの部屋', 'シカクの部屋'];

    for (let roomIndex = 0; roomIndex < rooms.length; roomIndex++) {
      // 部屋を選択（最初の部屋はデフォルト）
      if (roomIndex > 0) {
        const clicked = await page.evaluate((index) => {
          const roomButtons = Array.from(document.querySelectorAll('[class*="room"], button, div'))
            .filter(el => el.textContent.includes('部屋'));
          // クリック可能な部屋選択要素を探す
          const roomLinks = document.querySelectorAll('a, button');
          for (const link of roomLinks) {
            if (link.textContent.includes(index === 1 ? 'マル' : 'シカク')) {
              link.click();
              return true;
            }
          }
          return false;
        }, roomIndex);

        if (clicked) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // テーブルから空き情報を取得
      const tableData = await page.evaluate(() => {
        const data = {};

        // 日付ヘッダーを取得
        const headerCells = document.querySelectorAll('th, td');
        const dates = [];
        const year = new Date().getFullYear();

        for (const cell of headerCells) {
          const match = cell.textContent.match(/(\d{2})\/(\d{2})/);
          if (match) {
            const month = match[1];
            const day = match[2];
            dates.push(`${year}-${month}-${day}`);
          }
        }

        // 時間枠と空き状況を取得
        const rows = document.querySelectorAll('tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 2) continue;

          // 最初のセルから時間を取得
          const timeMatch = cells[0].textContent.match(/(\d{2}:\d{2})/);
          if (!timeMatch) continue;

          const startTime = timeMatch[1];

          // 各日付の空き状況をチェック
          for (let i = 1; i < cells.length && i - 1 < dates.length; i++) {
            const cell = cells[i];
            const dateStr = dates[i - 1];

            if (!dateStr) continue;

            // 価格が表示されていれば空きあり
            const hasPrice = /¥[\d,]+/.test(cell.textContent);
            const isEmpty = cell.textContent.trim() === '' || cell.textContent.trim() === '\n';

            if (hasPrice) {
              if (!data[dateStr]) {
                data[dateStr] = [];
              }
              data[dateStr].push(startTime);
            }
          }
        }

        return data;
      });

      // 部屋ごとのデータを結果にマージ
      const roomName = rooms[roomIndex];
      for (const [dateStr, times] of Object.entries(tableData)) {
        if (!result.dates[dateStr]) {
          result.dates[dateStr] = {};
        }
        result.dates[dateStr][roomName] = times;
      }
    }

    return result;
  } finally {
    await page.close();
  }
}

module.exports = { scrape };
