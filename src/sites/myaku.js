/**
 * 脈 -MYAKU PRIVATE SAUNA- (spot-ly) スクレイパー
 * URL: https://spot-ly.jp/ja/hotels/176
 *
 * モーダル内の時間帯ボタンから詳細な空き状況を取得
 * AI Vision APIを使用してグレーアウトされたボタンを検出
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const BASE_URL = 'https://spot-ly.jp/ja/hotels/176';

// Google AIクライアント
let aiClient = null;
function getAIClient() {
  if (!aiClient && process.env.GOOGLE_API_KEY) {
    aiClient = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  }
  return aiClient;
}

/**
 * スクリーンショットからグレーアウトされたスロットを検出
 * @param {Buffer} screenshotBuffer - モーダルのスクリーンショット
 * @param {Array} timeSlots - 時間帯の配列
 * @returns {Array} グレーアウトされた位置の配列 [{dayIdx, slotIdx}]
 */
async function detectDisabledSlotsFromImage(screenshotBuffer, timeSlots) {
  const genAI = getAIClient();
  if (!genAI) {
    console.log('    → AI Vision: GOOGLE_API_KEY未設定');
    return [];
  }

  const base64Image = screenshotBuffer.toString('base64');

  const prompt = `この画像はサウナ施設の予約モーダルです。カレンダー形式で7日分の予約枠が表示されています。

【判定ルール】
- グレー（灰色）の背景色のボタン → 予約不可（disabled）
- 白い背景のボタン → 予約可能（available）

【出力形式】
グレーアウトされている（予約不可の）ボタンの位置を以下のJSON形式で出力してください。
列（column）は左から0〜6（日付）、行（row）は上から0〜${timeSlots.length - 1}（時間帯）です。

例：左端の列の2行目と、右端の列の1行目がグレーの場合：
{"disabled": [{"col": 0, "row": 1}, {"col": 6, "row": 0}]}

グレーのボタンがない場合：
{"disabled": []}

JSONのみ出力：`;

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: { temperature: 0.1 }
    });

    const result = await model.generateContent([
      { inlineData: { mimeType: 'image/png', data: base64Image } },
      prompt
    ]);

    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.disabled || [];
    }
  } catch (error) {
    console.log(`    → AI Vision エラー: ${error.message}`);
  }

  return [];
}

// プラン情報（順序は空室状況ページでの表示順）
const PLANS = [
  {
    name: '休 KYU（90分/定員3名）¥9,130〜',
    planTitle: '【休 -KYU-】90分プラン（午後）',
    timeSlots: ['11:30〜13:00', '13:30〜15:00', '15:30〜17:00', '17:30〜19:00', '19:30〜21:00'],
    isNight: false,
    index: 0
  },
  {
    name: '水 MIZU（night/定員2名）¥8,800〜',
    planTitle: '【水 -MIZU-】ナイトパック',
    timeSlots: ['1:00〜8:30'],
    isNight: true,
    index: 1
  },
  {
    name: '水 MIZU（90分午後/定員2名）¥6,600〜',
    planTitle: '【水 -MIZU-】90分プラン（午後）',
    timeSlots: ['13:00〜14:30', '15:00〜16:30', '17:00〜18:30', '19:00〜20:30', '21:00〜22:30', '23:00〜0:30'],
    isNight: false,
    index: 2
  },
  {
    name: '水 MIZU（90分午前/定員2名）¥6,600〜',
    planTitle: '【水 -MIZU-】90分プラン（午前）',
    timeSlots: ['9:00〜10:30', '11:00〜12:30'],
    isNight: false,
    index: 3
  },
  {
    name: '火 HI（night/定員4名）¥10,120〜',
    planTitle: '【火 -HI-】ナイトパック',
    timeSlots: ['0:30〜8:00'],
    isNight: true,
    index: 4
  },
  {
    name: '火 HI（90分午後/定員4名）¥7,150〜',
    planTitle: '【火 -HI-】90分プラン（午後）',
    timeSlots: ['14:30〜16:00', '16:30〜18:00', '18:30〜20:00', '20:30〜22:00', '22:30〜0:00'],
    isNight: false,
    index: 5
  },
  {
    name: '火 HI（90分午前/定員4名）¥7,150〜',
    planTitle: '【火 -HI-】90分プラン（午前）',
    timeSlots: ['8:30〜10:00', '10:30〜12:00', '12:30〜14:00'],
    isNight: false,
    index: 6
  }
];

async function scrape(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 900 });

  try {
    console.log('    → 脈: アクセス中...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 3000));

    const result = { dates: {} };
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // 空室状況ページへ移動
    await page.click('button.bg-black');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 現在のURL確認（空室状況ページに移動していることを確認）
    const currentUrl = page.url();
    if (!currentUrl.includes('checkinDatetime')) {
      console.log('    → 脈: 空室状況ページへの移動に失敗');
      return result;
    }

    // 各プランを処理
    for (const plan of PLANS) {
      console.log(`    → ${plan.planTitle}: スクレイピング中...`);

      try {
        // ページ内の全React Selectと予約するボタンを取得
        const planCount = await page.evaluate(() => {
          const selectContainers = document.querySelectorAll('.css-b62m3t-container');
          const reserveButtons = document.querySelectorAll('button.w-\\[144px\\]');
          return { selects: selectContainers.length, buttons: reserveButtons.length };
        });

        if (plan.index * 2 >= planCount.selects) {
          console.log(`    → ${plan.planTitle}: ドロップダウンが見つかりません`);
          continue;
        }

        // このプランの大人ドロップダウンのインデックス（各プランに2つ: 大人と子供）
        const selectIndex = plan.index * 2;

        // ドロップダウンをクリックして1名を選択
        await page.evaluate((idx) => {
          const selectContainers = document.querySelectorAll('.css-b62m3t-container');
          if (selectContainers[idx]) {
            const control = selectContainers[idx].querySelector('.css-13cymwt-control');
            if (control) {
              control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            }
          }
        }, selectIndex);
        await new Promise(resolve => setTimeout(resolve, 500));

        // 1名オプションをクリック
        await page.evaluate(() => {
          const options = document.querySelectorAll('[class*="option"]');
          for (const opt of options) {
            if (opt.innerText.trim() === '1名') {
              opt.click();
              return true;
            }
          }
          return false;
        });
        await new Promise(resolve => setTimeout(resolve, 500));

        // 予約するボタンをクリック
        const buttonClicked = await page.evaluate((idx) => {
          const reserveButtons = document.querySelectorAll('button.w-\\[144px\\]');
          if (reserveButtons[idx] && !reserveButtons[idx].disabled) {
            reserveButtons[idx].click();
            return true;
          }
          return false;
        }, plan.index);

        if (!buttonClicked) {
          console.log(`    → ${plan.planTitle}: ボタンが無効です`);
          continue;
        }

        // モーダルが開くのを待つ
        await new Promise(resolve => setTimeout(resolve, 2000));

        // モーダルが完全に読み込まれるまで待機
        // 「日時を選ぶ」テキストを含むモーダルが表示されるのを待つ
        let modalReady = false;
        for (let i = 0; i < 10; i++) {
          modalReady = await page.evaluate(() => {
            // モーダルのタイトル「日時を選ぶ」を探す
            const modalTitle = Array.from(document.querySelectorAll('*')).find(
              el => el.innerText && el.innerText.includes('日時を選ぶ')
            );
            return !!modalTitle;
          });
          if (modalReady) break;
          await new Promise(r => setTimeout(r, 500));
        }
        if (!modalReady) {
          console.log(`    → ${plan.planTitle}: モーダルが開きませんでした`);
          continue;
        }

        // モーダルの描画完了を待機
        await new Promise(r => setTimeout(r, 2000));

        // スクリーンショットを撮影
        const screenshotBuffer = await page.screenshot({ encoding: 'binary' });

        // AI Vision APIで無効スロットを検出
        const disabledSlots = await detectDisabledSlotsFromImage(screenshotBuffer, plan.timeSlots);
        console.log(`    → AI Vision: ${disabledSlots.length}個のdisabledスロット検出`);

        // 日付ヘッダーを取得
        const dateInfo = await page.evaluate(() => {
          const dateTexts = [];
          // モーダル内の日付ヘッダーを探す
          const allDivs = document.querySelectorAll('div');
          for (const div of allDivs) {
            const text = div.innerText.trim();
            // 日付パターン: "11\n日" や "12\n月" など
            if (text.match(/^\d{1,2}\n[日月火水木金土]$/)) {
              const day = parseInt(text.split('\n')[0]);
              dateTexts.push(day);
            }
          }
          // 重複を除去して最初の7件を返す
          const unique = [...new Set(dateTexts)].slice(0, 7);
          return unique.length > 0 ? unique : null;
        });

        // 日付リストを構築
        const dates = [];
        if (dateInfo && dateInfo.length > 0) {
          for (const day of dateInfo) {
            dates.push({ day });
          }
        } else {
          // 日付が取得できない場合は今日から7日分
          const today = new Date();
          for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() + i);
            dates.push({ day: d.getDate(), month: d.getMonth() + 1 });
          }
        }

        // 無効スロットのセットを作成（高速ルックアップ用）
        const disabledSet = new Set(disabledSlots.map(s => `${s.col}-${s.row}`));

        // 空きスロットを計算（全スロット - 無効スロット）
        const availableSlots = [];
        const slotsPerDay = plan.timeSlots.length;
        const numDays = Math.min(dates.length, 7);

        for (let dayIdx = 0; dayIdx < numDays; dayIdx++) {
          for (let slotIdx = 0; slotIdx < slotsPerDay; slotIdx++) {
            const key = `${dayIdx}-${slotIdx}`;
            if (!disabledSet.has(key)) {
              availableSlots.push({
                day: dates[dayIdx].day,
                month: dates[dayIdx].month,
                timeSlot: plan.timeSlots[slotIdx]
              });
            }
          }
        }

        const availability = { availableSlots };

        // モーダルを閉じる（×ボタンまたはESC）
        await page.keyboard.press('Escape');
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 結果を処理
        let addedCount = 0;
        if (availability.availableSlots) {
          for (const slot of availability.availableSlots) {
            let month = slot.month || currentMonth;
            let year = currentYear;

            if (slot.day < now.getDate() - 7) {
              month = currentMonth + 1;
              if (month > 12) {
                month = 1;
                year++;
              }
            }

            let dateStr = `${year}-${String(month).padStart(2, '0')}-${String(slot.day).padStart(2, '0')}`;

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
            if (!result.dates[dateStr][plan.name].includes(slot.timeSlot)) {
              result.dates[dateStr][plan.name].push(slot.timeSlot);
              addedCount++;
            }
          }
        }

        console.log(`    → ${plan.planTitle}: 完了 (${addedCount}枠)`);

      } catch (err) {
        console.log(`    → ${plan.planTitle}: エラー - ${err.message}`);
      }
    }

    console.log(`    → 脈: ${Object.keys(result.dates).length}日分のデータ取得`);
    return result;

  } finally {
    await page.close();
  }
}

module.exports = { scrape };
