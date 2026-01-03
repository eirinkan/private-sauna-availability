/**
 * SAUNA OOO FUKUOKA (gflow) スクレイパー
 * URL: https://sw.gflow.cloud/ooo-fukuoka/calendar_open
 *
 * 3部屋: サンカク(2名), マル(4名), シカク(6名)
 * 構造: 日付テーブルとスケジュールテーブルが別
 * 空き=価格表示、空きなし=×
 */

const URL = 'https://sw.gflow.cloud/ooo-fukuoka/calendar_open';

const ROOMS = [
  { name: 'サンカク', selector: '.sankaku-h1', keyword: 'サンカク' },
  { name: 'マル', selector: '.prime-h1', keyword: 'マル' },
  { name: 'シカク', selector: '.vip-h1', keyword: 'シカク' }
];

async function scrape(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  try {
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 4000));

    const result = { dates: {} };

    // 3つの部屋を順番に取得
    for (let roomIndex = 0; roomIndex < ROOMS.length; roomIndex++) {
      const room = ROOMS[roomIndex];

      // 部屋カードをクリック（最初の部屋以外）
      if (roomIndex > 0) {
        const clicked = await page.evaluate((selector, keyword) => {
          // セレクタで直接探す
          const h1 = document.querySelector(selector);
          if (h1) {
            h1.click();
            return 'h1';
          }
          // キーワードで探す
          const elements = document.querySelectorAll('h1, div, span');
          for (const el of elements) {
            if (el.textContent.includes(keyword + 'の部屋')) {
              el.click();
              return 'keyword';
            }
          }
          return null;
        }, room.selector, room.keyword);

        if (clicked) {
          await new Promise(resolve => setTimeout(resolve, 2500));
        }
      }

      // 日付テーブル(index 6)と時間テーブル(index 7)からデータを取得
      const tableData = await page.evaluate(() => {
        const data = {};
        const year = new Date().getFullYear();
        const tables = document.querySelectorAll('table');

        // 日付テーブルを探す（日付パターンを含み、時間を含まないもの）
        let dates = [];
        let dateTable = null;
        for (const table of tables) {
          const text = table.textContent;
          if (/\d{2}\/\d{2}\([日月火水木金土]\)/.test(text) && !/\d{2}:\d{2}/.test(text)) {
            dateTable = table;
            const cells = table.querySelectorAll('th, td');
            for (const cell of cells) {
              const cellText = cell.textContent.trim();
              const match = cellText.match(/(\d{2})\/(\d{2})\([日月火水木金土]\)/);
              if (match) {
                dates.push(`${year}-${match[1]}-${match[2]}`);
              }
            }
            break;
          }
        }

        if (dates.length === 0) return data;

        // 時間テーブルを探す（時間と価格を含むもの）
        for (const table of tables) {
          const text = table.textContent;
          if (/\d{2}:\d{2}/.test(text) && /¥[\d,]+/.test(text)) {
            const rows = table.querySelectorAll('tr');

            for (const row of rows) {
              const cells = row.querySelectorAll('th, td');
              if (cells.length < 3) continue;

              // 最初のセルから時間を取得
              const firstCellText = cells[0].textContent;
              const timeMatch = firstCellText.match(/(\d{2}:\d{2})/);
              if (!timeMatch) continue;

              const startTime = timeMatch[1];

              // 列インデックス2から各日付の空き状況をチェック
              // (index 0=時間, index 1=空白スペーサー, index 2以降=日付)
              for (let i = 2; i < cells.length && i - 2 < dates.length; i++) {
                const cell = cells[i];
                const cellText = cell.textContent.trim();
                const dateStr = dates[i - 2];

                if (!dateStr) continue;

                // 空白 = 予約済み、価格表示 = 空きあり
                const hasPrice = /¥[\d,]+/.test(cellText);

                if (hasPrice) {
                  if (!data[dateStr]) {
                    data[dateStr] = [];
                  }
                  if (!data[dateStr].includes(startTime)) {
                    data[dateStr].push(startTime);
                  }
                }
              }
            }
            break;
          }
        }

        return data;
      });

      // 部屋ごとのデータを結果にマージ
      for (const [dateStr, times] of Object.entries(tableData)) {
        if (!result.dates[dateStr]) {
          result.dates[dateStr] = {};
        }
        result.dates[dateStr][room.name] = times.sort();
      }

      // 部屋データがなかった場合、空配列を設定
      if (Object.keys(tableData).length === 0) {
        const today = new Date();
        for (let i = 0; i < 7; i++) {
          const date = new Date(today);
          date.setDate(today.getDate() + i);
          const dateStr = date.toISOString().split('T')[0];
          if (!result.dates[dateStr]) {
            result.dates[dateStr] = {};
          }
          result.dates[dateStr][room.name] = [];
        }
      }
    }

    return result;
  } finally {
    await page.close();
  }
}

module.exports = { scrape };
