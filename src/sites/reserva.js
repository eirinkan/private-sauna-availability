/**
 * GIRAFFE (RESERVA) スクレイパー
 * 南天神店・天神店の両方を取得
 *
 * FlareSolverrでCloudflare Cookieを取得 → Puppeteerで使用
 * フォールバック: AI Vision API
 *
 * カレンダー構造:
 * - 日付が横軸（01/03, 01/04...）
 * - 時間が縦軸（8:30〜10:30, 11:00〜13:00...）
 * - ○ = 予約可能、× = 予約不可
 */

const flaresolverr = require('../flaresolverr');
const { analyzeScreenshot } = require('../ai-scraper');

// キャッシュされたCloudflare Cookies（セッション中は再利用）
let cachedCookies = null;
let cachedUserAgent = null;

// GIRAFFE 南天神店（統一フォーマット：部屋名（時間/定員）価格）
// ※実際のサイトで確認: 南天神店は「和の静寂」「温冷交互」
const GIRAFFE_MINAMITENJIN_ROOMS = [
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=72eJyzNDcztgQAAz8BEw&ctg_no=5aeJwzMjQyMAQAAuoA9w',
    name: '和の静寂（120分/定員4名）¥5,500-9,900'
  },
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=4feJyzNLcwMAIAAzgBCw&ctg_no=5aeJwzMjQyMAQAAuoA9w',
    name: '温冷交互（120分/定員4名）¥5,500-9,900'
  }
];

// GIRAFFE 天神店（統一フォーマット：部屋名（時間/定員）価格）
// ※実際のサイトで確認: 天神店は「陽」「陰」
const GIRAFFE_TENJIN_ROOMS = [
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=91eJwzNDAyszAGAAQpATU&ctg_no=05eJwzMjQ2NgIAAvQA_A',
    name: '「陽」光の陽彩（120分/定員7名）¥6,600-11,000'
  },
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=88eJwzNDAyszACAAQoATQ&ctg_no=05eJwzMjQ2NgIAAvQA_A',
    name: '「陰」静の陰影（120分/定員4名）¥7,700-11,000'
  },
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=6aeJwzNDAxNTcGAAQsATU&ctg_no=05eJwzMjQ2NgIAAvQA_A',
    name: '「陽」光の陽彩（night/定員2名）¥11,000-19,800'
  },
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=2eeJwzNDAxNTEEAAQkATA&ctg_no=05eJwzMjQ2NgIAAvQA_A',
    name: '「陰」静の陰影（night/定員2名）¥12,100-20,900'
  }
];

/**
 * FlareSolverrでCloudflare Cookieを取得
 */
async function getCloudfareCookies() {
  if (cachedCookies && cachedUserAgent) {
    return { cookies: cachedCookies, userAgent: cachedUserAgent };
  }

  try {
    const testUrl = 'https://reserva.be/giraffe_minamitenjin';
    console.log('  FlareSolverr: Cloudflare Cookie取得中...');
    const { cookies, userAgent } = await flaresolverr.getPageHtml(testUrl, 60000);

    if (cookies && cookies.length > 0) {
      cachedCookies = cookies;
      cachedUserAgent = userAgent;
      console.log(`  FlareSolverr: Cookie ${cookies.length}個取得成功`);
      return { cookies, userAgent };
    }
  } catch (error) {
    console.log(`  FlareSolverr: Cookie取得失敗 - ${error.message}`);
  }

  return null;
}

/**
 * Puppeteer用のカレンダー解析
 * RESERVAのカレンダーはinput.timebox要素に予約可能なスロットのデータを持つ
 * data-targetgroup: 日付 (例: "2026-01-06")
 * data-time: 時間 (例: "09:30～11:30")
 * data-vacancy: "1" で空きあり
 */
async function scrapeCalendarWithPuppeteer(page) {
  return await page.evaluate(() => {
    const result = {};
    const debugInfo = { total: 0, vacant: 0, processed: 0, splitFailed: 0 };

    // 方法1: input.timebox 要素から取得（最も正確）
    const timeboxInputs = document.querySelectorAll('input.timebox');
    debugInfo.total = timeboxInputs.length;

    if (timeboxInputs.length > 0) {
      timeboxInputs.forEach(input => {
        const targetGroup = input.dataset.targetgroup; // "2026-01-06"
        const time = input.dataset.time; // "09:30～11:30"
        const vacancy = input.dataset.vacancy;

        if (vacancy === '1') debugInfo.vacant++;

        if (targetGroup && time && vacancy === '1') {
          debugInfo.processed++;
          // 日付をYYYY-MM-DD形式に変換
          const dateStr = targetGroup; // すでにYYYY-MM-DD形式

          // 時間をそのまま使用（09:30～11:30形式）
          // 先頭の0を削除して統一（09:30→9:30）
          // 全角チルダ（～）と波ダッシュ（〜）の両方に対応
          const timeParts = time.split(/[～〜]/);
          if (timeParts.length < 2) {
            debugInfo.splitFailed++;
            return; // splitに失敗した場合はスキップ
          }
          const timeRange = timeParts[0].replace(/^0/, '') + '〜' + timeParts[1].replace(/^0/, '');

          if (!result[dateStr]) {
            result[dateStr] = [];
          }
          if (!result[dateStr].includes(timeRange)) {
            result[dateStr].push(timeRange);
          }
        }
      });

      // 結果をソート
      for (const dateStr of Object.keys(result)) {
        result[dateStr].sort((a, b) => {
          const timeA = a.split(':').map(Number);
          const timeB = b.split(':').map(Number);
          return (timeA[0] * 60 + timeA[1]) - (timeB[0] * 60 + timeB[1]);
        });
      }

      return result;
    }

    // 方法2: フォールバック - cal-timeframe要素を解析
    const cells = document.querySelectorAll('.cal-timeframe__item:not(.is-unavailable)');
    const year = new Date().getFullYear();

    cells.forEach(cell => {
      // 親の列から日付を取得
      const column = cell.closest('[data-date], .cal-timeframe__cell--data');
      if (!column) return;

      const dateAttr = column.dataset?.date;
      const timeText = cell.innerText.match(/(\d{1,2}:\d{2})～/);

      if (timeText) {
        const startTime = timeText[1];
        // 日付を取得（複数の方法を試す）
        let dateStr = dateAttr;
        if (!dateStr) {
          // ヘッダーから推測（実装省略）
          return;
        }

        if (!result[dateStr]) {
          result[dateStr] = [];
        }
        if (!result[dateStr].includes(startTime)) {
          result[dateStr].push(startTime);
        }
      }
    });

    return result;
  });
}

/**
 * FlareSolverr CookieでPuppeteerを使って部屋のデータを取得
 */
async function scrapeRoomWithCookies(browser, room, facilityName, cfData) {
  const page = await browser.newPage();

  try {
    // FlareSolverrから取得したUser-Agentを使用
    const userAgent = cfData?.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

    // FlareSolverrから取得したCookieを設定
    if (cfData?.cookies && cfData.cookies.length > 0) {
      const puppeteerCookies = cfData.cookies.map(cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain || '.reserva.be',
        path: cookie.path || '/',
        expires: cookie.expiry || -1,
        httpOnly: cookie.httpOnly || false,
        secure: cookie.secure || false,
        sameSite: cookie.sameSite || 'Lax'
      }));
      await page.setCookie(...puppeteerCookies);
    }

    // ボット検知回避を強化
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP', 'ja', 'en-US', 'en'] });
      window.chrome = { runtime: {} };
      // Permissions API
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    });

    // ページ読み込み（networkidle0でより確実に待機）
    await page.goto(room.url, { waitUntil: 'networkidle0', timeout: 90000 });

    // JavaScript実行完了を待機
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Cloudflareチャレンジページの検出
    const pageTitle = await page.title();
    console.log(`    ${facilityName}: ページタイトル = "${pageTitle}"`);
    // 「Just a moment」「しばらくお待ちください」はCloudflareチャレンジ
    if (pageTitle.includes('Just a moment') || pageTitle.includes('しばらくお待ちください') || pageTitle === '') {
      console.log(`    ${facilityName}: Cloudflareチャレンジページ検出 - スキップ`);
      return {};
    }

    // 日程選択セクションまでスクロール（カレンダーが画面下にあるため）
    await page.evaluate(() => {
      // 日程選択セクションを探してスクロール
      const dateSection = document.querySelector('#userselect-datetime') ||
                          document.querySelector('[class*="userselect-datetime"]') ||
                          document.querySelector('h2, h3');
      if (dateSection) {
        dateSection.scrollIntoView({ behavior: 'instant', block: 'start' });
      } else {
        // セクションが見つからない場合はページ下部にスクロール
        window.scrollTo(0, document.body.scrollHeight / 2);
      }
    });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // カレンダー展開を待機（timebox要素が出現するまで）
    let timeboxFound = false;
    try {
      await page.waitForSelector('input.timebox', { timeout: 15000 });
      timeboxFound = true;
    } catch (e) {
      // タイムアウトした場合、さらにスクロールを試みる
    }

    // timebox が見つからない場合、さらにスクロールして再試行
    if (!timeboxFound) {
      // ページ下部にスクロール
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await new Promise(resolve => setTimeout(resolve, 3000));

      // カレンダーセクションを探してスクロール
      await page.evaluate(() => {
        const dateSection = document.querySelector('[class*="userselect-datetime"], [class*="date-time"], #userselect-datetime, [class*="calendar"]');
        if (dateSection) {
          dateSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 再度待機
      try {
        await page.waitForSelector('input.timebox', { timeout: 10000 });
        timeboxFound = true;
      } catch (e) {
        // 引き続き処理
      }
    }

    // カレンダーテーブルまたはグリッドを探す
    let calendarData = await scrapeCalendarWithPuppeteer(page);

    // デバッグ: 抽出結果をログ出力
    const dateCount = Object.keys(calendarData).length;
    const totalSlots = Object.values(calendarData).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`    ${facilityName}: timebox抽出結果 = ${dateCount}日, ${totalSlots}枠`);
    if (dateCount === 0) {
      // timebox要素の存在を確認
      const timeboxCheck = await page.evaluate(() => {
        const all = document.querySelectorAll('input.timebox');
        const vacant = document.querySelectorAll('input.timebox[data-vacancy="1"]');
        return { total: all.length, vacant: vacant.length };
      });
      console.log(`    ${facilityName}: timebox要素 = total:${timeboxCheck.total}, vacant:${timeboxCheck.vacant}`);
    }

    // DOM解析で失敗した場合、AI Vision APIを使用
    if (Object.keys(calendarData).length === 0) {
      console.log(`  → ${room.name}: HTML解析失敗、AI Vision APIを使用...`);
      const screenshot = await page.screenshot({ fullPage: true });
      const targetDate = new Date().toISOString().split('T')[0];

      const aiResult = await analyzeScreenshot(screenshot, `${facilityName} ${room.name}`, targetDate);
      console.log(`    AI解析結果:`, JSON.stringify(aiResult));
      if (aiResult && aiResult.rooms) {
        for (const roomData of aiResult.rooms) {
          if (roomData.availableSlots && roomData.availableSlots.length > 0) {
            calendarData[aiResult.date] = roomData.availableSlots;
          }
        }
      }
    }

    return calendarData;
  } finally {
    await page.close();
  }
}

/**
 * 部屋のデータを取得（FlareSolverr Cookie + Puppeteer）
 */
async function scrapeRoom(browser, room, facilityName, cfData) {
  console.log(`  → ${room.name}: スクレイピング中...`);
  const calendarData = await scrapeRoomWithCookies(browser, room, facilityName, cfData);
  return calendarData || {};
}

/**
 * 店舗別スクレイピング（内部関数）
 */
async function scrapeStore(browser, rooms, storeName, cfData) {
  const result = { dates: {} };
  const today = new Date();

  // まず7日分の日付を初期化（全部屋に空配列を設定）
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    result.dates[dateStr] = {};
    for (const room of rooms) {
      result.dates[dateStr][room.name] = [];
    }
  }

  for (const room of rooms) {
    try {
      const calendarData = await scrapeRoom(browser, room, storeName, cfData);

      // 部屋ごとのデータを結果にマージ
      for (const [dateStr, times] of Object.entries(calendarData)) {
        if (result.dates[dateStr]) {
          result.dates[dateStr][room.name] = times.sort();
        }
      }
    } catch (error) {
      console.error(`${storeName} ${room.name} エラー:`, error.message);
    }
  }

  return result;
}

/**
 * GIRAFFE 南天神店スクレイピング
 */
async function scrapeMiamitenjin(browser) {
  // FlareSolverrからCloudflare Cookieを取得
  let cfData = null;
  const isFlareSolverrAvailable = await flaresolverr.isAvailable();
  if (isFlareSolverrAvailable) {
    cfData = await getCloudfareCookies();
  } else {
    console.log('  FlareSolverr: 利用不可（直接Puppeteerを使用）');
  }

  return scrapeStore(browser, GIRAFFE_MINAMITENJIN_ROOMS, 'GIRAFFE南天神', cfData);
}

/**
 * GIRAFFE 天神店スクレイピング
 */
async function scrapeTenjin(browser) {
  // FlareSolverrからCloudflare Cookieを取得（キャッシュ済みなら再利用）
  let cfData = null;
  const isFlareSolverrAvailable = await flaresolverr.isAvailable();
  if (isFlareSolverrAvailable) {
    cfData = await getCloudfareCookies();
  }

  return scrapeStore(browser, GIRAFFE_TENJIN_ROOMS, 'GIRAFFE天神', cfData);
}

module.exports = { scrapeMiamitenjin, scrapeTenjin };
