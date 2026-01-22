/**
 * サウナヨーガン福岡天神 (reserva.be) スクレイパー
 * URL: https://reserva.be/saunayogan
 *
 * 1部屋: プライベートサウナ (3名)
 * - ¥9,900（平日）/ ¥13,200（土日祝）
 * - 2時間30分制
 * - 時間枠: 10:00〜, 13:10〜, 16:20〜, 20:30〜
 *
 * FlareSolverrでCloudflare Cookieを取得 → Puppeteerで使用
 */

const flaresolverr = require('../flaresolverr');

const URL = 'https://reserva.be/saunayogan/reserve?mode=service_staff&search_evt_no=eeeJyzMDY2MQIAAxwBBQ';

// 部屋情報（統一フォーマット）
const ROOM_NAME = 'プライベートサウナ（150分/定員3名）¥9,900-13,200';

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
 * FlareSolverrでCloudflare Cookieを取得
 */
async function getCloudfareCookies() {
  try {
    const testUrl = 'https://reserva.be/saunayogan';
    console.log('    → サウナヨーガン: FlareSolverr Cookie取得中...');
    const { cookies, userAgent } = await flaresolverr.getPageHtml(testUrl, 60000);

    if (cookies && cookies.length > 0) {
      console.log(`    → サウナヨーガン: Cookie ${cookies.length}個取得成功`);
      return { cookies, userAgent };
    }
  } catch (error) {
    console.log(`    → サウナヨーガン: FlareSolverr Cookie取得失敗 - ${error.message}`);
  }

  return null;
}

/**
 * Puppeteerによるスクレイピング（FlareSolverr Cookie使用）
 */
async function scrape(browser) {
  const page = await browser.newPage();

  try {
    console.log('    → サウナヨーガン: スクレイピング開始');

    // FlareSolverrからCloudflare Cookieを取得
    let cfData = null;
    const isFlareSolverrAvailable = await flaresolverr.isAvailable();
    if (isFlareSolverrAvailable) {
      cfData = await getCloudfareCookies();
    } else {
      console.log('    → サウナヨーガン: FlareSolverr利用不可（直接アクセス）');
    }

    // Viewportを設定
    await page.setViewport({ width: 1280, height: 900 });

    // FlareSolverrから取得したUser-Agentを使用
    const userAgent = cfData?.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    await page.setUserAgent(userAgent);

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
      console.log(`    → サウナヨーガン: Cookieを設定 (${puppeteerCookies.length}個)`);
    }

    // ボット検知回避
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

    // ページにアクセス
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 });

    // ページ読み込み完了を待機
    await new Promise(resolve => setTimeout(resolve, 5000));

    // デバッグ: ページタイトル確認
    const pageTitle = await page.title();
    console.log(`    → サウナヨーガン: ページタイトル = "${pageTitle}"`);

    // Cloudflareチャレンジページの検出
    if (pageTitle.includes('Just a moment') || pageTitle.includes('しばらくお待ちください') || pageTitle === '') {
      console.log('    → サウナヨーガン: Cloudflareチャレンジページ検出');
      // 空のデータを返す
      const result = { dates: {} };
      const today = new Date();
      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const dateStr = formatLocalDate(date);
        result.dates[dateStr] = {};
        result.dates[dateStr][ROOM_NAME] = [];
      }
      return result;
    }

    // カレンダーのinput数を確認
    const inputCount = await page.evaluate(() => {
      return document.querySelectorAll('input[name="userselect_date"]').length;
    });
    console.log(`    → サウナヨーガン: カレンダーinput数 = ${inputCount}`);

    // 結果を格納
    const result = { dates: {} };
    const today = new Date();

    // 7日分の日付を初期化
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dateStr = formatLocalDate(date);
      result.dates[dateStr] = {};
      result.dates[dateStr][ROOM_NAME] = [];
    }

    // カレンダーから利用可能な日付を取得
    const availableDates = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[name="userselect_date"][data-targetdate]:not(.is-unavailable)');
      return Array.from(inputs).map(input => input.dataset.targetdate);
    });

    console.log(`    → サウナヨーガン: 利用可能日 = ${availableDates.length}日 [${availableDates.slice(0, 5).join(', ')}...]`);

    // 対象日付（今日から7日間）と利用可能日のマッチング
    const targetDates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dateStr = formatLocalDate(date);
      if (availableDates.includes(dateStr)) {
        targetDates.push(dateStr);
      }
    }

    console.log(`    → サウナヨーガン: 対象日 = ${targetDates.length}日`);

    // 各日付の時間枠を取得（page.goto()を削減し、日付クリックのみで取得）
    for (let i = 0; i < targetDates.length; i++) {
      const dateId = targetDates[i];

      // 日付をクリック（labelをクリック）- ページ再読み込みなしでDOM更新
      const clicked = await page.evaluate((dateId) => {
        const label = document.querySelector(`label[for="${dateId}"]`);
        if (label) {
          label.click();
          return true;
        }
        // 代替: inputを直接クリック
        const input = document.querySelector(`input#${CSS.escape(dateId)}`);
        if (input && !input.classList.contains('is-unavailable')) {
          input.click();
          return true;
        }
        return false;
      }, dateId);

      console.log(`    → サウナヨーガン: ${dateId} クリック = ${clicked}`);

      if (clicked) {
        // 時間枠のロードを待つ
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 時間枠を取得: input.timebox[data-vacancy="1"] の data-time
        const timeSlots = await page.evaluate(() => {
          const slots = [];

          // input.timebox[data-vacancy="1"] から取得
          const timeboxInputs = document.querySelectorAll('input.timebox[data-vacancy="1"]');
          timeboxInputs.forEach(input => {
            const time = input.dataset.time; // "10:00～12:30" 形式
            if (time) {
              // ～ を 〜 に統一
              const normalizedTime = time.replace(/[～~]/g, '〜');
              if (!slots.includes(normalizedTime)) {
                slots.push(normalizedTime);
              }
            }
          });

          return slots;
        });

        console.log(`    → サウナヨーガン: ${dateId} 空き枠 = ${timeSlots.length}個 [${timeSlots.join(', ')}]`);

        if (timeSlots.length > 0) {
          result.dates[dateId][ROOM_NAME] = timeSlots.sort((a, b) => {
            const [aH] = a.split(':').map(Number);
            const [bH] = b.split(':').map(Number);
            return aH - bH;
          });
        }
      }
    }

    return result;
  } finally {
    await page.close();
  }
}

module.exports = { scrape };
