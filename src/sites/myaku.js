/**
 * 脈 -MYAKU PRIVATE SAUNA- (spot-ly) スクレイパー
 * URL: https://spot-ly.jp/ja/hotels/176
 *
 * 重要ルール:
 * - カレンダーの◯✕マークは使用禁止（日単位の空き状況のみで具体的な時間帯がわからない）
 * - 必ずモーダルを開いて時間帯ボタンのdisabled属性で判定
 *
 * スクレイピングフロー:
 * 1. FlareSolverrでCookieとUserAgentを取得（ボット検出回避）
 * 2. 7日間の日付範囲パラメータ付きURLにアクセス（1回だけ）
 * 3. 各プランに対して：
 *    - 人数を1名に設定
 *    - 「予約する」ボタンをクリックしてモーダルを開く
 *    - モーダル内の7日×時間帯テーブルからdisabled属性で空き判定
 *    - Escapeでモーダルを閉じる
 *
 * 注意: FlareSolverr + puppeteer-extra-plugin-stealthを使用（ボット検出回避）
 */

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());

const flaresolverr = require('../flaresolverr');

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

/**
 * FlareSolverrでspot-ly.jpのCookieを取得（ボット検出回避）
 */
async function getSpotlyCookies() {
  try {
    console.log('    → 脈: FlareSolverr Cookie取得中...');
    const { cookies, userAgent } = await flaresolverr.getPageHtml(BASE_URL, 60000);

    if (cookies && cookies.length > 0) {
      console.log(`    → 脈: Cookie ${cookies.length}個取得成功`);
      return { cookies, userAgent };
    }
  } catch (error) {
    console.log(`    → 脈: FlareSolverr Cookie取得失敗 - ${error.message}`);
  }

  return null;
}

// 全体タイムアウト（2分）
const SCRAPE_TIMEOUT_MS = 120000;

async function scrape(puppeteerBrowser) {
  console.log('    → 脈: FlareSolverr + Stealthプラグインでスクレイピング開始');

  const startTime = Date.now();

  // タイムアウトチェック関数
  const isTimedOut = () => {
    const elapsed = Date.now() - startTime;
    if (elapsed > SCRAPE_TIMEOUT_MS) {
      console.log(`    → 脈: 全体タイムアウト (${Math.round(elapsed / 1000)}秒経過)`);
      return true;
    }
    return false;
  };

  // FlareSolverrからCookieを取得（ボット検出回避）
  let cfData = null;
  const isFlareSolverrAvailable = await flaresolverr.isAvailable();
  if (isFlareSolverrAvailable) {
    cfData = await getSpotlyCookies();
  } else {
    console.log('    → 脈: FlareSolverr利用不可（直接アクセス）');
  }

  // Cloud Run環境ではボット検出されるため、stealthプラグイン付きで独自ブラウザを起動
  const isCloudRun = !!process.env.K_SERVICE;
  const launchOptions = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  };
  if (isCloudRun) {
    launchOptions.executablePath = '/usr/bin/chromium';
  }

  const browser = await puppeteerExtra.launch(launchOptions);
  const page = await browser.newPage();

  // FlareSolverrから取得したUserAgentを使用
  const userAgent = cfData?.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  await page.setUserAgent(userAgent);
  await page.setViewport({ width: 1280, height: 900 });

  // FlareSolverrから取得したCookieを設定
  if (cfData?.cookies && cfData.cookies.length > 0) {
    const puppeteerCookies = cfData.cookies.map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain || '.spot-ly.jp',
      path: cookie.path || '/',
      expires: cookie.expiry || -1,
      httpOnly: cookie.httpOnly || false,
      secure: cookie.secure || false,
      sameSite: cookie.sameSite || 'Lax'
    }));
    await page.setCookie(...puppeteerCookies);
    console.log(`    → 脈: Cookieを設定 (${puppeteerCookies.length}個)`);
  }

  // ボット検知回避スクリプト
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP', 'ja', 'en-US', 'en'] });
    window.chrome = { runtime: {} };
  });

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
  });

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

    // 日付パラメータなしでアクセス（パラメータ付きだと「空室が見つかりませんでした」と表示される）
    const directUrl = BASE_URL;

    await page.goto(directUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    // ページの読み込み確認（ログ強化: 失敗時の状態を把握）
    const pageTitle = await page.title();
    console.log(`    → 脈: ページタイトル = "${pageTitle}"`);

    // ページ内容の先頭部分をログ出力（デバッグ用）
    const bodyPreview = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.substring(0, 200).replace(/\n/g, ' ');
    });
    console.log(`    → 脈: ページ内容プレビュー = "${bodyPreview.substring(0, 100)}..."`);

    // Cloudflare/ボット検出ページの検出
    if (pageTitle.includes('Just a moment') || pageTitle === '' || bodyPreview.includes('Checking your browser')) {
      console.log('    → 脈: ボット検出ページ検出 - 要調査');
      return { dates: {} };
    }

    // react-select要素（人数ドロップダウン）が表示されるまで待機
    try {
      await page.waitForFunction(() => {
        return document.querySelectorAll('[class*="-control"]').length > 0;
      }, { timeout: 10000 });
      console.log('    → 脈: react-select要素を検出');
    } catch (e) {
      console.log('    → 脈: react-select要素が見つからない（タイムアウト）');
      // フォールバック: プランカードが表示されているか確認
      try {
        await page.waitForSelector('button.bg-black', { timeout: 3000 });
      } catch (e2) {
        console.log('    → 脈: プランカードも表示されない');
        return { dates: {} };
      }
    }

    // 各プランを処理
    for (const plan of PLANS) {
      // タイムアウトチェック
      if (isTimedOut()) {
        console.log('    → 脈: タイムアウトのため残りプランをスキップ');
        break;
      }

      console.log(`    → 脈: ${plan.name} を処理中...`);

      try {
        // 最初の2つのボタンはヘッダー部分なので、pageIndex + 2が実際のプランボタンのインデックス
        const buttonIndex = plan.pageIndex + 2;

        // 1. 人数ドロップダウンで「1名」を選択
        // react-selectのcontrol要素にmousedownイベントを発火するとドロップダウンが開く
        // 各プランに大人・子供の2つのドロップダウンがあり、planIdx * 2が大人用のインデックス
        const controlIndex = plan.pageIndex * 2;

        const dropdownOpened = await page.evaluate((idx) => {
          const controls = document.querySelectorAll('[class*="-control"]');
          if (!controls[idx]) return false;
          controls[idx].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          return true;
        }, controlIndex);

        if (!dropdownOpened) {
          console.log(`    → 脈: ${plan.name} - ドロップダウンが見つからない (controlIndex: ${controlIndex})`);
          continue;
        }
        await new Promise(r => setTimeout(r, 500));

        // オプションが表示されるのを待機
        try {
          await page.waitForFunction(() => {
            return document.querySelectorAll('[class*="-option"]').length > 0;
          }, { timeout: 3000 });
        } catch (e) {
          console.log(`    → 脈: ${plan.name} - オプションが表示されない`);
          await page.keyboard.press('Escape');
          await new Promise(r => setTimeout(r, 300));
          continue;
        }

        // 1名オプションをクリック（デバッグログ強化）
        const optionInfo = await page.evaluate(() => {
          const options = document.querySelectorAll('[class*="-option"]');
          const optionTexts = Array.from(options).map(o => o.textContent.trim());
          let clicked = false;
          for (const opt of options) {
            if (opt.textContent.trim() === '1名') {
              opt.click();
              clicked = true;
              break;
            }
          }
          return { clicked, count: options.length, texts: optionTexts };
        });

        console.log(`    → 脈: ${plan.name} - オプション検出: ${optionInfo.count}個 [${optionInfo.texts.join(', ')}]`);

        if (!optionInfo.clicked) {
          console.log(`    → 脈: ${plan.name} - 1名オプションが見つからない`);
          await page.keyboard.press('Escape');
          await new Promise(r => setTimeout(r, 300));
          continue;
        }
        await new Promise(r => setTimeout(r, 500));

        // 2. 予約するボタンをクリック（デバッグログ強化）
        const reserveButtons = await page.$$('button.bg-black');
        console.log(`    → 脈: ${plan.name} - bg-blackボタン数: ${reserveButtons.length}, 目標インデックス: ${buttonIndex}`);

        if (!reserveButtons[buttonIndex]) {
          console.log(`    → 脈: ${plan.name} - 予約ボタンが見つからない`);
          continue;
        }

        const buttonState = await reserveButtons[buttonIndex].evaluate(btn => ({
          disabled: btn.disabled,
          text: btn.textContent.trim(),
          classes: btn.className
        }));
        console.log(`    → 脈: ${plan.name} - ボタン状態: disabled=${buttonState.disabled}, text="${buttonState.text.substring(0, 20)}"`);

        if (buttonState.disabled) {
          console.log(`    → 脈: ${plan.name} - 予約ボタンが無効`);
          continue;
        }

        await reserveButtons[buttonIndex].click();
        await new Promise(r => setTimeout(r, 3000));

        // 3. モーダルが開いて時間帯ボタンが表示されるまで待機
        try {
          await page.waitForFunction(() => {
            const buttons = document.querySelectorAll('button');
            return Array.from(buttons).some(b => /\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/.test(b.textContent));
          }, { timeout: 10000 });
        } catch (waitError) {
          console.log(`    → 脈: ${plan.name} - モーダル待機タイムアウト`);
          await page.keyboard.press('Escape');
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        // 4. モーダル内の時間帯ボタンを取得
        // ボタンのtextContentから「HH:MM - HH:MM」形式をシンプルに抽出
        const { modalSlots, debugInfo } = await page.evaluate(() => {
          const allButtons = document.querySelectorAll('button');
          const slots = [];
          const sampleTexts = [];

          allButtons.forEach((btn, idx) => {
            const text = btn.textContent.trim().replace(/\s+/g, '');
            // 最初の30ボタンのテキストをサンプルとして保存
            if (idx < 30) {
              sampleTexts.push({ idx, text: text.substring(0, 30) });
            }
            // パターン: "11:30-13:00"（[0-9]を使用 - \dが動作しない環境対策）
            const match = text.match(/([0-9]{1,2}:[0-9]{2})-([0-9]{1,2}:[0-9]{2})/);
            if (match) {
              slots.push({
                time: `${match[1]}〜${match[2]}`,
                disabled: btn.disabled,
                btnIdx: idx
              });
            }
          });

          return {
            modalSlots: slots,
            debugInfo: {
              totalButtons: allButtons.length,
              sampleTexts: sampleTexts.slice(15, 25) // モーダル内ボタンあたりを表示
            }
          };
        });

        console.log(`    → 脈: ${plan.name} - ボタン総数=${debugInfo.totalButtons}, サンプル=${JSON.stringify(debugInfo.sampleTexts)}`);

        // デバッグ: 取得した時間帯の最初の5件を出力
        const first5Times = modalSlots.slice(0, 5).map(s => s.time);
        console.log(`    → 脈: ${plan.name} - 取得セル数=${modalSlots.length}, 最初の5件=[${first5Times.join(', ')}]`);

        if (modalSlots.length > 0) {
          // 固定値を使用: 7日分のカレンダー、プラン定義のtimeSlotCount
          const dateCount = 7;
          const timeSlotCount = plan.timeSlotCount;
          const expectedTotal = dateCount * timeSlotCount;

          console.log(`    → 脈: ${plan.name} - 期待値: ${dateCount}日 × ${timeSlotCount}時間帯 = ${expectedTotal}セル, 実際: ${modalSlots.length}セル`);

          // テーブル構造: DOMは列優先（column-major）で配置
          // スロットの順序: (1日目時間帯1〜5), (2日目時間帯1〜5), ...
          // 1日分の全時間帯が連続して並んでいる
          for (let dayIndex = 0; dayIndex < dateCount && dayIndex < targetDates.length; dayIndex++) {
            const dateStr = targetDates[dayIndex];

            // この日付のスロットを取得（列優先: dayIndex * timeSlotCount + timeIndex）
            const daySlots = [];
            for (let timeIndex = 0; timeIndex < timeSlotCount; timeIndex++) {
              const slotIndex = dayIndex * timeSlotCount + timeIndex;
              if (modalSlots[slotIndex]) {
                daySlots.push(modalSlots[slotIndex]);
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
        await new Promise(r => setTimeout(r, 500));

        // 次のプランに備える（タイムアウトチェック後）
        if (plan.pageIndex < PLANS.length - 1) {
          if (isTimedOut()) {
            console.log('    → 脈: タイムアウトのため次のプラン処理をスキップ');
            break;
          }

          // ページをリロードして次のプランに備える
          // リロードしないとドロップダウンの状態が残り、次のプランで問題が起きる
          await page.goto(directUrl, { waitUntil: 'networkidle2', timeout: 30000 });
          await new Promise(r => setTimeout(r, 2000));
          // プランカードが表示されるまで待機
          await page.waitForSelector('[class*="-control"]', { timeout: 10000 }).catch(() => {});
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
    await browser.close();
  }
}

module.exports = { scrape };
