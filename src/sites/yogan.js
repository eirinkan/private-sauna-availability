/**
 * サウナヨーガン福岡天神 (reserva.be) スクレイパー
 * URL: https://reserva.be/saunayogan
 *
 * 1部屋: プライベートサウナ (3名)
 * - ¥9,900（平日）/ ¥13,200（土日祝）
 * - 2時間30分制
 * - 時間枠: 10:00〜, 13:10〜, 16:20〜, 19:30〜
 *
 * Cloudflare保護あり → FlareSolverr使用
 * カレンダーの日付をクリックして時間枠を取得
 *
 * Cloud Run環境: FlareSolverr HTMLを直接パース
 * ローカル環境: Puppeteerでインタラクティブに取得
 */

const flaresolverr = require('../flaresolverr');
const cheerio = require('cheerio');

const URL = 'https://reserva.be/saunayogan/reserve?mode=service_staff&search_evt_no=eeeJyzMDY2MQIAAxwBBQ';

// 部屋情報（統一フォーマット）
const ROOM_NAME = 'プライベートサウナ（150分/定員3名）¥9,900-13,200';

// キャッシュされたCloudflare Cookies
let cachedCookies = null;
let cachedUserAgent = null;

/**
 * FlareSolverrでCloudflare Cookieを取得
 */
async function getCloudfareCookies() {
  if (cachedCookies && cachedUserAgent) {
    return { cookies: cachedCookies, userAgent: cachedUserAgent };
  }

  try {
    const testUrl = 'https://reserva.be/saunayogan';
    console.log('  サウナヨーガン: Cloudflare Cookie取得中...');
    const { cookies, userAgent } = await flaresolverr.getPageHtml(testUrl, 60000);

    if (cookies && cookies.length > 0) {
      cachedCookies = cookies;
      cachedUserAgent = userAgent;
      console.log(`  サウナヨーガン: Cookie ${cookies.length}個取得成功`);
      return { cookies, userAgent };
    }
  } catch (error) {
    console.log(`  サウナヨーガン: Cookie取得失敗 - ${error.message}`);
  }

  return null;
}

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
 * FlareSolverr HTML直接パース方式（Cloud Run環境向け）
 * 各日付のページを直接FlareSolverrで取得してパース
 */
async function scrapeWithFlareSolverr() {
  const result = { dates: {} };
  const today = new Date();

  console.log('    サウナヨーガン: FlareSolverr直接HTML方式を使用');

  // 7日分の日付を処理
  for (let i = 0; i < 7; i++) {
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + i);
    const dateStr = formatLocalDate(targetDate);

    // 日付初期化
    result.dates[dateStr] = {};
    result.dates[dateStr][ROOM_NAME] = [];

    try {
      // 日付固有のURLを構築（reserva.beの日付パラメータ形式）
      const dateUrl = `https://reserva.be/saunayogan/reserve?mode=service_staff&search_evt_no=eeeJyzMDY2MQIAAxwBBQ&sel_date=${dateStr}`;

      console.log(`    サウナヨーガン: ${dateStr} FlareSolverr取得中...`);
      const { html } = await flaresolverr.getPageHtml(dateUrl, 60000);

      if (!html) {
        console.log(`    サウナヨーガン: ${dateStr} HTML取得失敗`);
        continue;
      }

      // Cloudflareチャレンジページチェック
      if (html.includes('Just a moment') || html.includes('Cloudflare') || html.includes('しばらくお待ちください')) {
        console.log(`    サウナヨーガン: ${dateStr} Cloudflareチャレンジ - スキップ`);
        continue;
      }

      // cheerioでHTMLをパース
      const $ = cheerio.load(html);

      // 時間枠を抽出: input.timebox[data-vacancy="1"]
      const timeSlots = [];
      $('input.timebox[data-vacancy="1"]').each((_, el) => {
        const time = $(el).attr('data-time');
        if (time) {
          // ～ を 〜 に統一
          const normalizedTime = time.replace(/[～~]/g, '〜');
          if (!timeSlots.includes(normalizedTime)) {
            timeSlots.push(normalizedTime);
          }
        }
      });

      // 代替: label.timebox内のテキストから抽出
      if (timeSlots.length === 0) {
        $('label.timebox').each((_, el) => {
          const text = $(el).text().trim();
          // "10:00～12:30" のようなパターンを抽出
          const timeMatch = text.match(/(\d{1,2}:\d{2})[～~〜](\d{1,2}:\d{2})/);
          if (timeMatch) {
            const normalizedTime = `${timeMatch[1]}〜${timeMatch[2]}`;
            // 予約済みでないか確認（is-reserved クラスがないか）
            if (!$(el).hasClass('is-reserved') && !$(el).hasClass('is-unavailable')) {
              if (!timeSlots.includes(normalizedTime)) {
                timeSlots.push(normalizedTime);
              }
            }
          }
        });
      }

      console.log(`    サウナヨーガン: ${dateStr} 空き枠 = ${timeSlots.length}個 [${timeSlots.join(', ')}]`);

      if (timeSlots.length > 0) {
        result.dates[dateStr][ROOM_NAME] = timeSlots.sort((a, b) => {
          const [aH] = a.split(':').map(Number);
          const [bH] = b.split(':').map(Number);
          return aH - bH;
        });
      }
    } catch (error) {
      console.log(`    サウナヨーガン: ${dateStr} エラー - ${error.message}`);
    }
  }

  return result;
}

/**
 * Puppeteerによるインタラクティブ方式（ローカル環境向け）
 */
async function scrapeWithPuppeteer(browser) {
  const page = await browser.newPage();

  try {
    // FlareSolverrからCloudflare Cookieを取得
    let cfData = null;
    const isFlareSolverrAvailable = await flaresolverr.isAvailable();
    if (isFlareSolverrAvailable) {
      cfData = await getCloudfareCookies();
    } else {
      console.log('  サウナヨーガン: FlareSolverr利用不可（直接アクセス試行）');
    }

    // User-Agentを設定
    const userAgent = cfData?.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: 1280, height: 900 });

    // FlareSolverr Cookieを設定
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
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP', 'ja', 'en-US', 'en'] });
      window.chrome = { runtime: {} };
    });

    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise(resolve => setTimeout(resolve, 5000));

    // デバッグ: ページタイトルとURL確認
    let pageTitle = await page.title();
    console.log(`    サウナヨーガン: ページタイトル = "${pageTitle}"`);

    // Cloudflareチャレンジページかどうかチェック
    if (pageTitle.includes('Just a moment') || pageTitle.includes('Cloudflare') || pageTitle.includes('しばらくお待ちください')) {
      // 少し待ってもう一度確認（自動でチャレンジを通過できる場合がある）
      await new Promise(resolve => setTimeout(resolve, 10000));
      pageTitle = await page.title();
      console.log(`    サウナヨーガン: 再確認後のページタイトル = "${pageTitle}"`);

      if (pageTitle.includes('Just a moment') || pageTitle.includes('Cloudflare') || pageTitle.includes('しばらくお待ちください')) {
        console.log('    サウナヨーガン: Cloudflareチャレンジページ検出 - FlareSolverr方式にフォールバック');
        await page.close();
        // FlareSolverr HTML方式を試行
        return await scrapeWithFlareSolverr();
      }
    }

    // 日程選択セクションまでスクロール
    await page.evaluate(() => {
      const dateSection = document.querySelector('#userselect-datetime') ||
                          document.querySelector('[class*="datetime"]') ||
                          document.querySelector('.cal-date-list');
      if (dateSection) {
        dateSection.scrollIntoView({ behavior: 'instant', block: 'start' });
      } else {
        window.scrollTo(0, document.body.scrollHeight / 2);
      }
    });
    await new Promise(resolve => setTimeout(resolve, 2000));

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

    // カレンダーの日付をクリックして時間枠を取得
    for (let i = 0; i < 7; i++) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + i);
      const dateStr = formatLocalDate(targetDate);
      const dateId = formatLocalDate(targetDate); // YYYY-MM-DD形式

      // 2日目以降は再度ページにアクセス（goBackが効かないため）
      if (i > 0) {
        await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // 日付が利用可能か確認してクリック
      // input[id="2026-01-11"][data-targetdate]:not(.is-unavailable)
      const clicked = await page.evaluate((dateId) => {
        // カレンダーのinput要素を探す
        const input = document.querySelector(`input#${CSS.escape(dateId)}:not(.is-unavailable)`);
        if (input && input.dataset.targetdate) {
          // 対応するlabelをクリック
          const label = document.querySelector(`label[for="${dateId}"]`);
          if (label) {
            label.click();
            return 'label';
          }
          // labelがなければinputをクリック
          input.click();
          return 'input';
        }
        return null;
      }, dateId);

      console.log(`    サウナヨーガン: ${dateStr} クリック結果 = ${clicked}`);

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

        console.log(`    サウナヨーガン: ${dateStr} 空き枠 = ${timeSlots.length}個 [${timeSlots.join(', ')}]`);

        if (timeSlots.length > 0) {
          result.dates[dateStr][ROOM_NAME] = timeSlots.sort((a, b) => {
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

/**
 * メインスクレイピング関数
 * 環境に応じて適切な方式を選択
 */
async function scrape(browser) {
  // Cloud Run環境かどうかをチェック
  const isCloudRun = process.env.K_SERVICE || process.env.CLOUD_RUN;
  const isFlareSolverrAvailable = await flaresolverr.isAvailable();

  console.log(`    サウナヨーガン: 環境=${isCloudRun ? 'Cloud Run' : 'ローカル'}, FlareSolverr=${isFlareSolverrAvailable ? '利用可能' : '利用不可'}`);

  // Cloud Run環境でFlareSolverrが利用可能な場合、HTML直接パース方式を使用
  if (isCloudRun && isFlareSolverrAvailable) {
    return await scrapeWithFlareSolverr();
  }

  // それ以外はPuppeteer方式
  return await scrapeWithPuppeteer(browser);
}

module.exports = { scrape };
