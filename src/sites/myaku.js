/**
 * 脈 -MYAKU PRIVATE SAUNA- (spot-ly) スクレイパー
 * URL: https://spot-ly.jp/ja/hotels/176
 *
 * 重要ルール:
 * - カレンダーの◯✕マークは使用禁止（日単位の空き状況のみで具体的な時間帯がわからない）
 * - 必ずモーダルを開いて時間帯ボタンのdisabled属性で判定
 * - ボタンのインデックスで直接指定（ページ上の順序は固定）
 *
 * スクレイピングフロー:
 * 1. 日付パラメータ付きURLにアクセス
 * 2. 人数を1名に設定
 * 3. 「予約する」ボタンをクリックしてモーダルを開く
 * 4. モーダル内の時間帯ボタンのdisabled属性で空き判定
 */

const BASE_URL = 'https://spot-ly.jp/ja/hotels/176';

// プラン情報（ページ上のボタン順序に対応）
const PLANS = [
  {
    pageIndex: 0,
    name: '休 KYU（90分/定員3名）¥9,130〜',
    timeSlots: ['11:30〜13:00', '13:30〜15:00', '15:30〜17:00', '17:30〜19:00', '19:30〜21:00'],
  },
  {
    pageIndex: 1,
    name: '水 MIZU（night/定員2名）¥8,800〜',
    timeSlots: ['1:00〜8:30'],
    isNight: true,
  },
  {
    pageIndex: 2,
    name: '水 MIZU（90分午後/定員2名）¥6,600〜',
    timeSlots: ['13:00〜14:30', '15:00〜16:30', '17:00〜18:30', '19:00〜20:30', '21:00〜22:30', '23:00〜0:30'],
  },
  {
    pageIndex: 3,
    name: '水 MIZU（90分午前/定員2名）¥6,600〜',
    timeSlots: ['9:00〜10:30', '11:00〜12:30'],
  },
  {
    pageIndex: 4,
    name: '火 HI（night/定員4名）¥10,120〜',
    timeSlots: ['0:30〜8:00'],
    isNight: true,
  },
  {
    pageIndex: 5,
    name: '火 HI（90分午後/定員4名）¥7,150〜',
    timeSlots: ['14:30〜16:00', '16:30〜18:00', '18:30〜20:00', '20:30〜22:00', '22:30〜0:00'],
  },
  {
    pageIndex: 6,
    name: '火 HI（90分午前/定員4名）¥7,150〜',
    timeSlots: ['8:30〜10:00', '10:30〜12:00', '12:30〜14:00'],
  }
];

async function scrape(puppeteerBrowser) {
  console.log('    → 脈: 共有Puppeteerブラウザを使用');

  const page = await puppeteerBrowser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 900 });

  try {
    const result = { dates: {} };
    const now = new Date();

    // 日付パラメータ付きURLに直接アクセス
    const checkinDate = now.toISOString().split('T')[0];
    const checkoutDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const directUrl = `${BASE_URL}?checkinDatetime=${checkinDate}+00%3A00%3A00&checkoutDatetime=${checkoutDate}+00%3A00%3A00`;

    // 各プランを処理
    for (const plan of PLANS) {
      console.log(`    → 脈: ${plan.name} を処理中...`);

      try {
        // ページにアクセス（毎回リフレッシュしてモーダルをクリア）
        await page.goto(directUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 2000));

        const buttonIndex = plan.pageIndex;

        // 1. 人数ドロップダウンで「1名」を選択
        const controls = await page.$$('[class*="-control"]');
        const targetControlIndex = buttonIndex * 2; // 各プランに「大人」「子供」の2つのcontrolがある
        console.log(`    → 脈: ${plan.name} - ドロップダウン検索 (index=${targetControlIndex}, total=${controls.length})`);

        if (controls[targetControlIndex]) {
          await controls[targetControlIndex].click();
          await new Promise(r => setTimeout(r, 1500)); // 待ち時間を増加

          // 「1名」オプションをクリック
          const options = await page.$$('[class*="-option"]');
          console.log(`    → 脈: ${plan.name} - オプション数=${options.length}`);

          let optionFound = false;
          for (const opt of options) {
            const text = await opt.evaluate(el => el.textContent.trim());
            if (text === '1名') {
              await opt.click();
              optionFound = true;
              console.log(`    → 脈: ${plan.name} - 1名を選択`);
              break;
            }
          }
          if (!optionFound) {
            console.log(`    → 脈: ${plan.name} - 1名オプションが見つからない`);
          }
          await new Promise(r => setTimeout(r, 1000)); // 待ち時間を増加
        } else {
          console.log(`    → 脈: ${plan.name} - ドロップダウンが見つからない`);
        }

        // 2. 予約するボタンをクリック
        const reserveButtons = await page.$$('button[class*="w-[144px]"]');
        if (!reserveButtons[buttonIndex]) {
          console.log(`    → 脈: ${plan.name} - 予約ボタンが見つからない`);
          continue;
        }

        const isDisabled = await reserveButtons[buttonIndex].evaluate(btn => btn.disabled);
        if (isDisabled) {
          console.log(`    → 脈: ${plan.name} - 予約ボタンがdisabled`);
          continue;
        }

        await reserveButtons[buttonIndex].click();
        console.log(`    → 脈: ${plan.name} - 予約ボタンをクリック`);
        await new Promise(r => setTimeout(r, 3000));

        // 3. モーダル内の時間帯ボタンを取得
        const modalData = await page.evaluate(() => {
          const allButtons = document.querySelectorAll('button');
          const slots = [];

          allButtons.forEach(btn => {
            const text = btn.textContent.trim();
            // 時間パターンにマッチ（"11:30-13:00" や "11:30 - 13:00"）
            const timeMatch = text.match(/(\d{1,2}:\d{2})\s*[-ー]\s*(\d{1,2}:\d{2})/);
            if (timeMatch && text.length < 30) {
              slots.push({
                time: `${timeMatch[1]}〜${timeMatch[2]}`,
                disabled: btn.disabled
              });
            }
          });

          return { hasModal: slots.length > 0, slots };
        });

        if (modalData.hasModal && modalData.slots.length > 0) {
          const availableSlots = modalData.slots.filter(s => !s.disabled);
          const firstThree = availableSlots.slice(0, 3).map(s => s.time).join(', ');
          console.log(`    → ${plan.name}: ${availableSlots.length}/${modalData.slots.length}枠空き [${firstThree}...]`);

          // 現在の日付のデータとして保存
          const dateStr = checkinDate;
          if (!result.dates[dateStr]) {
            result.dates[dateStr] = {};
          }
          if (!result.dates[dateStr][plan.name]) {
            result.dates[dateStr][plan.name] = [];
          }

          availableSlots.forEach(slot => {
            let timeStr = slot.time;
            // ナイトパックの場合は翌日の日付を先頭に付与（GIRAFFE形式に統一）
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
        } else {
          console.log(`    → ${plan.name}: モーダルが開けませんでした`);
        }

        // モーダルを閉じる
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 500));

      } catch (e) {
        console.error(`    → 脈: ${plan.name} 処理エラー:`, e.message);
      }
    }

    console.log(`    → 脈: ${Object.keys(result.dates).length}日分のデータ取得`);
    return result;

  } finally {
    await page.close();
  }
}

module.exports = { scrape };
