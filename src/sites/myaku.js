/**
 * 脈 -MYAKU PRIVATE SAUNA- (spot-ly) スクレイパー
 * URL: https://spot-ly.jp/ja/hotels/176
 *
 * 重要ルール:
 * - カレンダーの◯✕マークは使用禁止（日単位の空き状況のみで具体的な時間帯がわからない）
 * - 必ずモーダルを開いて時間帯ボタンのdisabled属性で判定
 *
 * スクレイピングフロー:
 * 1. 7日間の日付範囲パラメータ付きURLにアクセス（1回だけ）
 * 2. 各プランに対して：
 *    - 人数を1名に設定
 *    - 「予約する」ボタンをクリックしてモーダルを開く
 *    - モーダル内の7日×時間帯テーブルからdisabled属性で空き判定
 *    - Escapeでモーダルを閉じる
 */

const BASE_URL = 'https://spot-ly.jp/ja/hotels/176';

// プラン情報（ページ上のボタン順序に対応）
const PLANS = [
  {
    pageIndex: 0,
    name: '休 KYU（90分/定員3名）¥9,130〜',
    timeSlotCount: 5, // 11:30〜13:00, 13:30〜15:00, 15:30〜17:00, 17:30〜19:00, 19:30〜21:00
  },
  {
    pageIndex: 1,
    name: '水 MIZU（night/定員2名）¥8,800〜',
    timeSlotCount: 1, // 1:00〜8:30
    isNight: true,
  },
  {
    pageIndex: 2,
    name: '水 MIZU（90分午後/定員2名）¥6,600〜',
    timeSlotCount: 6, // 13:00〜14:30, 15:00〜16:30, 17:00〜18:30, 19:00〜20:30, 21:00〜22:30, 23:00〜0:30
  },
  {
    pageIndex: 3,
    name: '水 MIZU（90分午前/定員2名）¥6,600〜',
    timeSlotCount: 2, // 9:00〜10:30, 11:00〜12:30
  },
  {
    pageIndex: 4,
    name: '火 HI（night/定員4名）¥10,120〜',
    timeSlotCount: 1, // 0:30〜8:00
    isNight: true,
  },
  {
    pageIndex: 5,
    name: '火 HI（90分午後/定員4名）¥7,150〜',
    timeSlotCount: 5, // 14:30〜16:00, 16:30〜18:00, 18:30〜20:00, 20:30〜22:00, 22:30〜0:00
  },
  {
    pageIndex: 6,
    name: '火 HI（90分午前/定員4名）¥7,150〜',
    timeSlotCount: 3, // 8:30〜10:00, 10:30〜12:00, 12:30〜14:00
  }
];

/**
 * ローカル日付をYYYY-MM-DD形式で取得
 */
function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function scrape(puppeteerBrowser) {
  console.log('    → 脈: 共有Puppeteerブラウザを使用');

  const page = await puppeteerBrowser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 900 });

  try {
    const result = { dates: {} };
    const today = new Date();

    // 7日分の日付を生成
    const targetDates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      targetDates.push(formatLocalDate(date));
    }

    console.log(`    → 脈: ${targetDates.length}日分をスクレイピング [${targetDates[0]} 〜 ${targetDates[6]}]`);

    // 7日間の日付範囲でURLにアクセス（1回だけ）
    const startDate = targetDates[0];
    const endDate = targetDates[6];
    const directUrl = `${BASE_URL}?checkinDatetime=${startDate}+00%3A00%3A00&checkoutDatetime=${endDate}+00%3A00%3A00`;

    await page.goto(directUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    // 各プランを処理
    for (const plan of PLANS) {
      console.log(`    → 脈: ${plan.name} を処理中...`);

      try {
        // 最初の2つのボタンはヘッダー部分なので、pageIndex + 2が実際のプランボタンのインデックス
        const buttonIndex = plan.pageIndex + 2;

        // 1. 人数ドロップダウンで「1名」を選択
        // react-selectのinputをフォーカスしてドロップダウンを開く
        // ドロップダウンはプラン順（pageIndex）に並んでいる（各プランに大人・子供の2つ）
        const inputId = `react-select-${2 + plan.pageIndex * 2}-input`;
        await page.evaluate((id) => {
          const input = document.querySelector(`#${id}`);
          if (input) {
            input.focus();
            const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
            input.dispatchEvent(event);
          }
        }, inputId);
        await new Promise(r => setTimeout(r, 1000));

        // 1名オプションをクリック
        const selectedOne = await page.evaluate(() => {
          const options = document.querySelectorAll('[class*="-option"]');
          for (const opt of options) {
            if (opt.textContent.trim() === '1名') {
              opt.click();
              return true;
            }
          }
          return false;
        });

        if (!selectedOne) {
          console.log(`    → 脈: ${plan.name} - 1名オプションが見つからない`);
          continue;
        }
        await new Promise(r => setTimeout(r, 1000));

        // 2. 予約するボタンをクリック
        const reserveButtons = await page.$$('button.bg-black');
        if (!reserveButtons[buttonIndex]) {
          console.log(`    → 脈: ${plan.name} - 予約ボタンが見つからない`);
          continue;
        }

        const isDisabled = await reserveButtons[buttonIndex].evaluate(btn => btn.disabled);
        if (isDisabled) {
          console.log(`    → 脈: ${plan.name} - 予約ボタンが無効`);
          continue;
        }

        await reserveButtons[buttonIndex].click();
        await new Promise(r => setTimeout(r, 3000));

        // 3. モーダル内の日付ヘッダーと時間帯ボタンを取得
        const modalData = await page.evaluate(() => {
          // 日付ヘッダーを取得（14水, 15木, ...）
          const dateHeaders = [];
          const headerDivs = document.querySelectorAll('.w-full.text-center');
          headerDivs.forEach(div => {
            const text = div.textContent.trim();
            // "14水11:30-13:00..." のような形式から日付部分を抽出
            const match = text.match(/^(\d{1,2})([\u6708\u706b\u6c34\u6728\u91d1\u571f\u65e5])/);
            if (match) {
              dateHeaders.push({
                day: parseInt(match[1]),
                dayOfWeek: match[2]
              });
            }
          });

          // 時間帯セルを取得
          const cells = document.querySelectorAll('.border.border-gray-200.p-0');
          const slots = [];
          cells.forEach(cell => {
            const btn = cell.querySelector('button');
            if (btn) {
              const text = btn.textContent.trim();
              const timeMatch = text.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
              if (timeMatch) {
                slots.push({
                  time: `${timeMatch[1]}〜${timeMatch[2]}`,
                  disabled: btn.disabled
                });
              }
            }
          });

          return {
            hasModal: slots.length > 0,
            dateCount: dateHeaders.length,
            dateHeaders,
            slots
          };
        });

        if (modalData.hasModal && modalData.slots.length > 0) {
          const dateCount = modalData.dateCount || 7;
          const timeSlotCount = Math.floor(modalData.slots.length / dateCount);

          // テーブル構造: 行=時間帯、列=日付
          // スロットの順序: (14日の時間帯1), (15日の時間帯1), ..., (14日の時間帯2), (15日の時間帯2), ...
          // 各日付の空き時間枠を抽出
          for (let dayIndex = 0; dayIndex < dateCount && dayIndex < targetDates.length; dayIndex++) {
            const dateStr = targetDates[dayIndex];

            // この日付のスロットを取得（各時間帯行のdayIndex番目のセル）
            const daySlots = [];
            for (let timeIndex = 0; timeIndex < timeSlotCount; timeIndex++) {
              const slotIndex = timeIndex * dateCount + dayIndex;
              if (modalData.slots[slotIndex]) {
                daySlots.push(modalData.slots[slotIndex]);
              }
            }

            const availableSlots = daySlots.filter(s => !s.disabled);

            if (availableSlots.length > 0) {
              if (!result.dates[dateStr]) {
                result.dates[dateStr] = {};
              }
              if (!result.dates[dateStr][plan.name]) {
                result.dates[dateStr][plan.name] = [];
              }

              availableSlots.forEach(slot => {
                let timeStr = slot.time;
                // ナイトパックの場合は翌日の日付を先頭に付与
                if (plan.isNight) {
                  const nextDay = new Date(dateStr);
                  nextDay.setDate(nextDay.getDate() + 1);
                  const nextMonth = nextDay.getMonth() + 1;
                  const nextDayNum = nextDay.getDate();
                  timeStr = `${nextMonth}/${nextDayNum} ${slot.time}`;
                }
                if (!result.dates[dateStr][plan.name].includes(timeStr)) {
                  result.dates[dateStr][plan.name].push(timeStr);
                }
              });
            }
          }
        }

        // モーダルを閉じる
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 1000));

        // ページをリロードして次のプランに備える（モーダル状態をリセット）
        if (plan.pageIndex < PLANS.length - 1) {
          await page.goto(directUrl, { waitUntil: 'networkidle2', timeout: 60000 });
          await new Promise(r => setTimeout(r, 2000));
        }

      } catch (e) {
        console.log(`    → 脈: ${plan.name} - エラー: ${e.message}`);
      }
    }

    // 結果のログ出力
    const dateCount = Object.keys(result.dates).length;
    let totalSlots = 0;
    for (const dateData of Object.values(result.dates)) {
      for (const slots of Object.values(dateData)) {
        totalSlots += slots.length;
      }
    }
    console.log(`    → 脈: ${dateCount}日分のデータ取得, ${totalSlots}枠`);

    return result;

  } finally {
    await page.close();
  }
}

module.exports = { scrape };
