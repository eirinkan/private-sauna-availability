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

// GIRAFFE 全店舗の部屋URL（店舗統合表示）
// 南天神店（ctg_no=05eJwzMjQ2NgIAAvQA_A）
// 天神店（ctg_no=5aeJwzMjQyMAQAAuoA9w）
const GIRAFFE_ALL_ROOMS = [
  // 南天神店
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=91eJwzNDAyszAGAAQpATU&ctg_no=05eJwzMjQ2NgIAAvQA_A',
    name: '南天神：「陽」光の陽彩【120分】'
  },
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=88eJwzNDAyszACAAQoATQ&ctg_no=05eJwzMjQ2NgIAAvQA_A',
    name: '南天神：「陰」静の陰影【120分】'
  },
  // 天神店
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=72eJyzNDcztgQAAz8BEw&ctg_no=5aeJwzMjQyMAQAAuoA9w',
    name: '天神：和の静寂【120分】'
  },
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=4feJyzNLcwMAIAAzgBCw&ctg_no=5aeJwzMjQyMAQAAuoA9w',
    name: '天神：温冷交互【120分】'
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

    // 方法1: input.timebox 要素から取得（最も正確）
    const timeboxInputs = document.querySelectorAll('input.timebox');

    if (timeboxInputs.length > 0) {
      timeboxInputs.forEach(input => {
        const targetGroup = input.dataset.targetgroup; // "2026-01-06"
        const time = input.dataset.time; // "09:30～11:30"
        const vacancy = input.dataset.vacancy;

        if (targetGroup && time && vacancy === '1') {
          // 日付をYYYY-MM-DD形式に変換
          const dateStr = targetGroup; // すでにYYYY-MM-DD形式

          // 時間を開始時間のみに変換（09:30～11:30 → 9:30）
          const startTime = time.split('～')[0].replace(/^0/, '');

          if (!result[dateStr]) {
            result[dateStr] = [];
          }
          if (!result[dateStr].includes(startTime)) {
            result[dateStr].push(startTime);
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
    const userAgent = cfData?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

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

    // ボット検知回避
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      window.chrome = { runtime: {} };
    });

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
    });

    // ページ読み込み
    await page.goto(room.url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // カレンダーセクションまでスクロール
    await page.evaluate(() => {
      const dateSection = document.querySelector('[class*="userselect-datetime"], [class*="date-time"], #userselect-datetime');
      if (dateSection) {
        dateSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        window.scrollTo(0, document.body.scrollHeight);
      }
    });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // "Hourly Booking" または時間予約タイプをクリック
    const clickedTimeType = await page.evaluate(() => {
      // ラジオボタンまたは予約タイプを探してクリック
      const timeRadio = document.querySelector('input[value="time"], input[id*="date-type-time"]');
      if (timeRadio) {
        timeRadio.click();
        return 'radio clicked';
      }

      // ラベルをクリック
      const labels = Array.from(document.querySelectorAll('label'));
      for (const label of labels) {
        if (label.textContent.includes('Hourly') || label.textContent.includes('時間') || label.textContent.includes('Time')) {
          label.click();
          return 'label clicked';
        }
      }

      // userselect-date__type-selector をクリック
      const typeSelector = document.querySelector('[class*="type-selector"]');
      if (typeSelector) {
        typeSelector.click();
        return 'selector clicked';
      }

      return 'nothing clicked';
    });

    // カレンダー展開を待機（timebox要素が出現するまで）
    try {
      await page.waitForSelector('input.timebox', { timeout: 10000 });
    } catch (e) {
      // タイムアウトしても続行
    }
    await new Promise(resolve => setTimeout(resolve, 3000));

    // カレンダーテーブルまたはグリッドを探す
    let calendarData = await scrapeCalendarWithPuppeteer(page);

    // DOM解析で失敗した場合、AI Vision APIを使用
    if (Object.keys(calendarData).length === 0) {
      console.log(`  → ${room.name}: HTML解析失敗、AI Vision APIを使用...`);
      const screenshot = await page.screenshot({ fullPage: true });
      const targetDate = new Date().toISOString().split('T')[0];

      const aiResult = await analyzeScreenshot(screenshot, `${facilityName} ${room.name}`, targetDate);
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
 * GIRAFFE 全店舗スクレイピング（南天神・天神統合）
 */
async function scrape(browser) {
  const result = { dates: {} };
  const today = new Date();

  // FlareSolverrからCloudflare Cookieを取得
  let cfData = null;
  const isFlareSolverrAvailable = await flaresolverr.isAvailable();
  if (isFlareSolverrAvailable) {
    cfData = await getCloudfareCookies();
  } else {
    console.log('  FlareSolverr: 利用不可（直接Puppeteerを使用）');
  }

  for (const room of GIRAFFE_ALL_ROOMS) {
    try {
      const calendarData = await scrapeRoom(browser, room, 'GIRAFFE', cfData);

      // 部屋ごとのデータを結果にマージ
      for (const [dateStr, times] of Object.entries(calendarData)) {
        if (!result.dates[dateStr]) {
          result.dates[dateStr] = {};
        }
        result.dates[dateStr][room.name] = times.sort();
      }

      // データがない場合は空配列
      if (Object.keys(calendarData).length === 0) {
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
    } catch (error) {
      console.error(`GIRAFFE ${room.name} エラー:`, error.message);
    }
  }

  return result;
}

module.exports = { scrape };
