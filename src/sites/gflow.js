/**
 * SAUNA OOO FUKUOKA (gflow) スクレイパー
 * URL: https://sw.gflow.cloud/ooo-fukuoka/calendar_open
 *
 * 3部屋: サンカク(2名), マル(4名), シカク(6名)
 * 構造: 日付テーブルとスケジュールテーブルが別
 * 空き=価格表示、空きなし=×
 *
 * 注意: 各部屋で時間枠が異なる
 * - サンカク: 100分/120分 (08:00~09:40, 10:10~11:50...)
 * - マル: 100分/120分 (08:30~10:10, 10:40~12:20...)
 * - シカク: 120分のみ (08:40~10:40, 11:10~13:10...)
 */

const URL = 'https://sw.gflow.cloud/ooo-fukuoka/calendar_open';

// 統一フォーマット：部屋名（時間/定員）価格
// 期待される最初の時間枠も定義（テーブル更新の確認用）
const ROOMS = [
  { name: 'サンカク（100分/120分/定員2名）¥4,500-8,500', keyword: 'サンカク', altKeyword: 'Triangle', expectedFirstTime: '08:00' },
  { name: 'マル（100分/120分/定員3名）¥5,000-11,500', keyword: 'マル', altKeyword: 'PRIME', expectedFirstTime: '08:30' },
  { name: 'シカク（120分/定員4名）¥7,000-18,000', keyword: 'シカク', altKeyword: 'VIP', expectedFirstTime: '08:40' }
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

      // 部屋カードをPuppeteerネイティブのclickで選択
      // input[type="radio"]を直接クリックする（label経由ではなく）
      let clicked = false;

      // 方法1: input要素を直接操作（Vue.jsリアクティビティ対応）
      const radioHandles = await page.$$('input[type="radio"]');
      for (const radio of radioHandles) {
        const parentText = await page.evaluate(el => {
          const parent = el.closest('label') || el.parentElement;
          return parent ? parent.textContent : '';
        }, radio);

        if (parentText.includes(room.keyword) || parentText.includes(room.altKeyword)) {
          // スクロールして可視化
          await page.evaluate(el => el.scrollIntoView({ block: 'center' }), radio);
          await new Promise(resolve => setTimeout(resolve, 500));

          // Vue.js対応: ネイティブセッターを使用してv-modelバインディングをトリガー
          await page.evaluate(el => {
            // 方法1: ネイティブのinputセッターを使用（React/Vue対応）
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype, 'checked'
            )?.set;

            if (nativeInputValueSetter) {
              nativeInputValueSetter.call(el, true);
            } else {
              el.checked = true;
            }

            // 方法2: 各種イベントをディスパッチ
            const inputEvent = new Event('input', { bubbles: true, cancelable: true });
            const changeEvent = new Event('change', { bubbles: true, cancelable: true });
            el.dispatchEvent(inputEvent);
            el.dispatchEvent(changeEvent);

            // 方法3: 親labelにもイベントを伝播
            const label = el.closest('label');
            if (label) {
              label.click();
            }
          }, radio);

          clicked = true;
          console.log(`    → OOO ${room.keyword}: radio+イベント発火成功`);
          break;
        }
      }

      // 方法2: label要素をマウス座標でクリック（フォールバック）
      if (!clicked) {
        const labelHandles = await page.$$('label.box-room');
        for (const label of labelHandles) {
          const text = await page.evaluate(el => el.textContent || '', label);
          if (text.includes(room.keyword + 'の部屋') || text.includes(room.altKeyword)) {
            // 要素を可視化してスクロール
            await page.evaluate(el => el.scrollIntoView({ block: 'center' }), label);
            await new Promise(resolve => setTimeout(resolve, 500));

            // 要素の座標を取得してマウスでクリック（最も確実な方法）
            const box = await label.boundingBox();
            if (box) {
              const x = box.x + box.width / 2;
              const y = box.y + box.height / 2;
              await page.mouse.click(x, y);
              clicked = true;
              console.log(`    → OOO ${room.keyword}: マウスクリック成功 (${Math.round(x)}, ${Math.round(y)})`);
            } else {
              // フォールバック: 通常のクリック
              try {
                await label.click();
                clicked = true;
                console.log(`    → OOO ${room.keyword}: labelクリック成功`);
              } catch (e) {
                await page.evaluate(el => el.click(), label);
                clicked = true;
                console.log(`    → OOO ${room.keyword}: label JSクリック成功`);
              }
            }
            break;
          }
        }
      }

      console.log(`    → OOO ${room.keyword}: クリック=${clicked}`);

      if (clicked) {
        // テーブルが期待する時間枠に更新されるまで待機（最大20秒）
        const expectedTime = room.expectedFirstTime;
        try {
          await page.waitForFunction(
            (expected) => {
              const tables = document.querySelectorAll('table.gold-table');
              if (tables.length < 2) return false;
              const bodyTable = tables[1];
              const firstRow = bodyTable.querySelector('tr');
              if (!firstRow) return false;
              const firstCell = firstRow.querySelector('td');
              if (!firstCell) return false;
              const text = firstCell.textContent || '';
              return text.includes(expected);
            },
            { timeout: 20000 },
            expectedTime
          );
          console.log(`    → OOO ${room.keyword}: テーブル更新確認 (${expectedTime})`);
        } catch (e) {
          console.log(`    → OOO ${room.keyword}: テーブル更新タイムアウト (期待:${expectedTime})`);
          // タイムアウト時は追加で待機
          await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // 追加の安定化待機
        await new Promise(resolve => setTimeout(resolve, 1500));

        // 更新後の時間枠を確認
        const afterTimeSlot = await page.evaluate(() => {
          const tables = document.querySelectorAll('table.gold-table');
          if (tables.length < 2) return null;
          const bodyTable = tables[1];
          const firstRow = bodyTable.querySelector('tr');
          if (!firstRow) return null;
          const firstCell = firstRow.querySelector('td');
          if (!firstCell) return null;
          const text = firstCell.textContent || '';
          const match = text.match(/(\d{2}:\d{2})~\s*(\d{2}:\d{2})/);
          return match ? match[0] : text.substring(0, 20);
        });
        console.log(`    → OOO ${room.keyword}: 最初の時間枠="${afterTimeSlot}" (期待: ${expectedTime})`);
      }

      // gold-tableからデータを取得
      const tableData = await page.evaluate(() => {
        const data = {};
        const debug = { dateCount: 0, rowCount: 0, timeMatches: 0, availableCount: 0, timeSlots: [] };
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
          debug.timeSlots.push(timeRange);

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
        const { timeSlots, ...debugWithoutSlots } = tableData.debug;
        console.log(`    → OOO ${room.keyword}: debug=${JSON.stringify(debugWithoutSlots)}`);
        if (timeSlots && timeSlots.length > 0) {
          console.log(`    → OOO ${room.keyword}: 時間枠=[${timeSlots.slice(0, 3).join(', ')}...]`);
        }
      }

      // dataを抽出
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
