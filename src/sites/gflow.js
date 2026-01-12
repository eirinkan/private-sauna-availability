/**
 * SAUNA OOO FUKUOKA (gflow) スクレイパー
 * URL: https://sw.gflow.cloud/ooo-fukuoka/calendar_open
 *
 * 3部屋: サンカク(2名), マル(4名), シカク(6名)
 * 構造: 日付テーブルとスケジュールテーブルが別
 * 空き=価格表示、空きなし=×
 */

const URL = 'https://sw.gflow.cloud/ooo-fukuoka/calendar_open';

// 統一フォーマット：部屋名（時間/定員）価格
const ROOMS = [
  { name: 'サンカク（100分/120分/定員2名）¥4,500-8,500', selector: '.sankaku-h1', keyword: 'サンカク' },
  { name: 'マル（100分/120分/定員3名）¥5,000-11,500', selector: '.prime-h1', keyword: 'マル' },
  { name: 'シカク（120分/定員4名）¥7,000-18,000', selector: '.vip-h1', keyword: 'シカク' }
];

async function scrape(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  try {
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });

    // テーブル要素の出現を待つ（Cloud Run環境対応）
    try {
      await page.waitForSelector('table.gold-table', { timeout: 30000 });
    } catch (e) {
      console.log('    → OOO: gold-table待機タイムアウト、スクロール試行...');
      // テーブルが見つからない場合、スクロールして再試行
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // 予約枠セクションまでスクロール（Cloud Run環境対応）
    await page.evaluate(() => {
      const section = document.querySelector('table.gold-table') ||
                      document.querySelector('[class*="calendar"]') ||
                      document.querySelector('h2, h3');
      if (section) {
        section.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    });

    // 追加の待機時間（JavaScript実行完了まで）
    await new Promise(resolve => setTimeout(resolve, 5000));

    const result = { dates: {} };

    // 3つの部屋を順番に取得
    for (let roomIndex = 0; roomIndex < ROOMS.length; roomIndex++) {
      const room = ROOMS[roomIndex];
      console.log(`    → OOO: ${room.keyword}をスクレイピング中...`);

      // 部屋カードをクリック（最初の部屋以外）
      if (roomIndex > 0) {
        const clicked = await page.evaluate((selector, keyword) => {
          // label.box-room 内のh1要素を探す
          const labels = document.querySelectorAll('label.box-room');
          for (const label of labels) {
            const h1 = label.querySelector(selector);
            if (h1) {
              label.click();
              return 'label-h1';
            }
            // キーワードでマッチ
            if (label.textContent.includes(keyword + 'の部屋')) {
              label.click();
              return 'label-keyword';
            }
          }
          // フォールバック: h1要素を直接探す
          const h1 = document.querySelector(selector);
          if (h1) {
            h1.click();
            return 'h1';
          }
          return null;
        }, room.selector, room.keyword);

        if (clicked) {
          // テーブルが更新されるまで待機（Cloud Run環境対応）
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      }

      // gold-tableからデータを取得
      // 空き: td.cursor + ri-checkbox-blank-circle-line
      // 埋まり: td.bg-gray + ri-close-line

      // デバッグ: テーブル数を確認
      const tableCount = await page.evaluate(() => document.querySelectorAll('table.gold-table').length);
      if (tableCount < 2) {
        console.log(`    → OOO ${room.keyword}: gold-table不足（${tableCount}個）、ページタイトル確認中...`);
        const title = await page.title();
        console.log(`    → OOO ${room.keyword}: ページタイトル = "${title}"`);
      }

      const tableData = await page.evaluate(() => {
        const data = {};
        const debug = { dateCount: 0, rowCount: 0, timeMatches: 0, availableCount: 0 };
        const year = new Date().getFullYear();

        // gold-tableを取得
        const tables = document.querySelectorAll('table.gold-table');
        if (tables.length < 2) return { data, debug: { ...debug, error: 'tables < 2', count: tables.length } };

        // 最初のテーブル（thead）から日付を取得
        const headerTable = tables[0];
        const dates = [];
        const headerCells = headerTable.querySelectorAll('th');
        headerCells.forEach(th => {
          const text = th.textContent.trim();
          // "01/12<br>(月)" 形式
          const match = text.match(/(\d{2})\/(\d{2})/);
          if (match) {
            dates.push(`${year}-${match[1]}-${match[2]}`);
          }
        });
        debug.dateCount = dates.length;

        if (dates.length === 0) return { data, debug: { ...debug, error: 'no dates' } };

        // 2番目のテーブル（tbody）から時間枠と空き状況を取得
        const bodyTable = tables[1];
        const rows = bodyTable.querySelectorAll('tr');
        debug.rowCount = rows.length;

        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length < 2) return;

          // 最初のセルから時間を取得
          // 日本語: "08:40~10:40 120分" / 英語: "08:40~ 10:40 120 minutes"
          const firstCellText = cells[0].textContent;
          const timeMatch = firstCellText.match(/(\d{2}:\d{2})~\s*(\d{2}:\d{2})/);
          if (!timeMatch) return;
          debug.timeMatches++;

          const timeRange = timeMatch[1] + '〜' + timeMatch[2];

          // 2列目以降が日付データ（1列目は時間）
          for (let i = 1; i < cells.length && i - 1 < dates.length; i++) {
            const cell = cells[i];
            const dateStr = dates[i - 1];
            if (!dateStr) continue;

            // 空き判定: td.cursor を持つか、ri-checkbox-blank-circle-line アイコンがあるか
            const isAvailable = cell.classList.contains('cursor') ||
                               cell.querySelector('i.ri-checkbox-blank-circle-line') !== null;
            // 埋まり判定: td.bg-gray を持つか、ri-close-line アイコンがあるか
            const isUnavailable = cell.classList.contains('bg-gray') ||
                                  cell.querySelector('i.ri-close-line') !== null;

            if (isAvailable && !isUnavailable) {
              debug.availableCount++;
              if (!data[dateStr]) {
                data[dateStr] = [];
              }
              if (!data[dateStr].includes(timeRange)) {
                data[dateStr].push(timeRange);
              }
            }
          }
        });

        return { data, debug };
      });

      // デバッグ情報をログ出力
      if (tableData.debug) {
        console.log(`    → OOO ${room.keyword}: debug=${JSON.stringify(tableData.debug)}`);
      }

      // dataを抽出（旧コードとの互換性）
      const extractedData = tableData.data || tableData;

      // デバッグ: 取得したデータを表示
      const slotCount = Object.values(extractedData).reduce((sum, arr) => sum + arr.length, 0);
      console.log(`    → OOO ${room.keyword}: ${Object.keys(extractedData).length}日分, ${slotCount}枠取得`);

      // まず7日分の日付を確保（部屋データがあってもなくても）
      const today = new Date();
      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        if (!result.dates[dateStr]) {
          result.dates[dateStr] = {};
        }
        // この部屋のデータがなければ空配列を設定
        if (!result.dates[dateStr][room.name]) {
          result.dates[dateStr][room.name] = [];
        }
      }

      // 部屋ごとのデータを結果にマージ（上書き）
      for (const [dateStr, times] of Object.entries(extractedData)) {
        if (!result.dates[dateStr]) {
          result.dates[dateStr] = {};
        }
        result.dates[dateStr][room.name] = times.sort();
      }
    }

    return result;
  } finally {
    await page.close();
  }
}

module.exports = { scrape };
