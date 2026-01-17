require('dotenv').config();

const express = require('express');
const path = require('path');
const { scrapeAll, getAvailability } = require('./scraper');
const { PRICING } = require('./pricing');

const app = express();
const PORT = process.env.PORT || 3000;

// 静的ファイル配信
app.use(express.static(path.join(__dirname, '../public')));

// API: 空き状況取得
app.get('/api/availability', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const data = await getAvailability(date);
  res.json(data);
});

// API: 手動更新トリガー（POST/GET両対応 - Cloud Scheduler用）
const handleRefresh = async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] スクレイピング開始 (${req.method})`);
    await scrapeAll();
    console.log(`[${new Date().toISOString()}] スクレイピング完了`);
    res.json({ success: true, message: '更新完了' });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] スクレイピングエラー:`, error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};
app.post('/api/refresh', handleRefresh);
app.get('/api/refresh', handleRefresh);

// API: ヘルスチェック
const VERSION = '2026-01-13-v2'; // デプロイ確認用
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: VERSION, timestamp: new Date().toISOString() });
});

// API: Puppeteer診断（Cloud Run環境デバッグ用）
app.get('/api/debug/puppeteer', async (req, res) => {
  const puppeteer = require('puppeteer');
  const startTime = Date.now();
  const results = { steps: [], errors: [] };

  try {
    results.steps.push({ step: 'start', time: Date.now() - startTime });
    results.environment = {
      K_SERVICE: process.env.K_SERVICE || 'not set',
      NODE_ENV: process.env.NODE_ENV || 'not set',
      PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH || 'not set',
      FLARESOLVERR_URL: process.env.FLARESOLVERR_URL || 'not set'
    };

    results.steps.push({ step: 'launching', time: Date.now() - startTime });
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    results.steps.push({ step: 'browser_launched', time: Date.now() - startTime });

    const page = await browser.newPage();
    results.steps.push({ step: 'page_created', time: Date.now() - startTime });

    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    results.steps.push({ step: 'navigation_complete', time: Date.now() - startTime });

    const title = await page.title();
    results.title = title;
    results.steps.push({ step: 'title_retrieved', time: Date.now() - startTime });

    await browser.close();
    results.steps.push({ step: 'browser_closed', time: Date.now() - startTime });

    results.success = true;
    results.totalTime = Date.now() - startTime;
    res.json(results);
  } catch (error) {
    results.success = false;
    results.error = error.message;
    results.stack = error.stack;
    results.totalTime = Date.now() - startTime;
    res.status(500).json(results);
  }
});

// API: 料金情報取得
app.get('/api/pricing', (req, res) => {
  res.json(PRICING);
});

// API: FlareSolverr診断エンドポイント
app.get('/api/debug/flaresolverr', async (req, res) => {
  const flaresolverr = require('./flaresolverr');
  const axios = require('axios');
  const results = {
    environment: {
      FLARESOLVERR_URL: process.env.FLARESOLVERR_URL || 'not set'
    },
    tests: []
  };

  // 1. isAvailable() テスト
  try {
    const isAvail = await flaresolverr.isAvailable();
    results.tests.push({ name: 'isAvailable()', success: true, result: isAvail });
  } catch (e) {
    results.tests.push({ name: 'isAvailable()', success: false, error: e.message });
  }

  // 2. 直接ヘルスチェック
  const healthUrl = (process.env.FLARESOLVERR_URL || '').replace('/v1', '/health');
  try {
    const healthRes = await axios.get(healthUrl, { timeout: 10000 });
    results.tests.push({ name: 'health check', success: true, status: healthRes.status, data: healthRes.data });
  } catch (e) {
    results.tests.push({ name: 'health check', success: false, error: e.message, url: healthUrl });
  }

  // 3. FlareSolverrでreserva.beを試す
  try {
    const testResult = await flaresolverr.getPageHtml('https://reserva.be/giraffe_minamitenjin', 30000);
    results.tests.push({
      name: 'reserva.be test',
      success: true,
      cookieCount: testResult.cookies?.length || 0,
      userAgent: testResult.userAgent?.substring(0, 50),
      htmlLength: testResult.html?.length || 0
    });
  } catch (e) {
    results.tests.push({ name: 'reserva.be test', success: false, error: e.message });
  }

  res.json(results);
});

// API: OOO専用デバッグエンドポイント
app.get('/api/debug/ooo', async (req, res) => {
  const puppeteer = require('puppeteer');
  const startTime = Date.now();
  const results = { steps: [], errors: [] };

  let browser;
  try {
    results.steps.push({ step: 'start', time: 0 });

    const isCloudRun = !!process.env.K_SERVICE;
    const launchOptions = {
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    };
    if (isCloudRun) {
      launchOptions.executablePath = '/usr/bin/chromium';
    }

    browser = await puppeteer.launch(launchOptions);
    results.steps.push({ step: 'browser_launched', time: Date.now() - startTime });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    await page.setViewport({ width: 1280, height: 800 });
    results.steps.push({ step: 'page_created', time: Date.now() - startTime });

    const url = 'https://sw.gflow.cloud/ooo-fukuoka/calendar_open';
    results.url = url;

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
    results.steps.push({ step: 'page_loaded', time: Date.now() - startTime });

    // ページタイトル確認
    const pageTitle = await page.title();
    results.pageTitle = pageTitle;

    // 初回待機
    await new Promise(r => setTimeout(r, 5000));
    results.steps.push({ step: 'wait_5s', time: Date.now() - startTime });

    // gold-table確認
    const tableInfo = await page.evaluate(() => {
      const tables = document.querySelectorAll('table.gold-table');
      const allTables = document.querySelectorAll('table');
      const labels = document.querySelectorAll('label.box-room');

      return {
        goldTableCount: tables.length,
        allTableCount: allTables.length,
        labelCount: labels.length,
        bodyLength: document.body.innerHTML.length,
        hasCalendar: !!document.querySelector('[class*="calendar"]'),
        firstTableClasses: allTables[0]?.className || 'none',
        labelTexts: Array.from(labels).slice(0, 3).map(l => l.textContent.substring(0, 30))
      };
    });
    results.tableInfo = tableInfo;
    results.steps.push({ step: 'table_check', time: Date.now() - startTime });

    // スクロールしてテーブルを探す
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise(r => setTimeout(r, 3000));

    const afterScrollInfo = await page.evaluate(() => {
      const tables = document.querySelectorAll('table.gold-table');
      return { goldTableCount: tables.length };
    });
    results.afterScrollInfo = afterScrollInfo;
    results.steps.push({ step: 'after_scroll', time: Date.now() - startTime });

    // さらに待機してからテーブルデータ取得を試みる
    await new Promise(r => setTimeout(r, 5000));

    const tableData = await page.evaluate(() => {
      const data = {};
      const year = new Date().getFullYear();
      const tables = document.querySelectorAll('table.gold-table');

      if (tables.length < 2) {
        return { error: 'Not enough tables', count: tables.length };
      }

      const headerTable = tables[0];
      const dates = [];
      const headerCells = headerTable.querySelectorAll('th');
      headerCells.forEach(th => {
        const text = th.textContent.trim();
        const match = text.match(/(\d{2})\/(\d{2})/);
        if (match) {
          dates.push(`${year}-${match[1]}-${match[2]}`);
        }
      });

      const bodyTable = tables[1];
      const rows = bodyTable.querySelectorAll('tr');
      let slotCount = 0;

      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) return;

        const firstCellText = cells[0].textContent;
        // 日本語/英語両対応: "08:40~10:40" or "08:40~ 10:40"
        const timeMatch = firstCellText.match(/(\d{2}:\d{2})~\s*(\d{2}:\d{2})/);
        if (!timeMatch) return;

        const timeRange = timeMatch[1] + '〜' + timeMatch[2];

        for (let i = 1; i < cells.length && i - 1 < dates.length; i++) {
          const cell = cells[i];
          const dateStr = dates[i - 1];
          if (!dateStr) continue;

          const isAvailable = cell.classList.contains('cursor') ||
                             cell.querySelector('i.ri-checkbox-blank-circle-line') !== null;
          const isUnavailable = cell.classList.contains('bg-gray') ||
                                cell.querySelector('i.ri-close-line') !== null;

          if (isAvailable && !isUnavailable) {
            if (!data[dateStr]) data[dateStr] = [];
            if (!data[dateStr].includes(timeRange)) {
              data[dateStr].push(timeRange);
              slotCount++;
            }
          }
        }
      });

      // 行の詳細情報を取得（デバッグ用）
      const sampleRows = [];
      let timeMatchCount = 0;
      for (let rowIdx = 0; rowIdx < Math.min(rows.length, 5); rowIdx++) {
        const row = rows[rowIdx];
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) continue;
        const firstCellText = cells[0].textContent.trim();
        const timeMatch = firstCellText.match(/(\d{2}:\d{2})~\s*(\d{2}:\d{2})/);
        if (timeMatch) timeMatchCount++;
        sampleRows.push({
          rowIdx,
          firstCellText: firstCellText.substring(0, 50),
          timeMatch: timeMatch ? timeMatch[0] : null,
          cellCount: cells.length
        });
      }

      // セルの詳細情報を取得
      const sampleCells = [];
      const firstRow = rows[0];
      if (firstRow) {
        const cells = firstRow.querySelectorAll('td');
        for (let i = 1; i < Math.min(cells.length, 4); i++) {
          const cell = cells[i];
          sampleCells.push({
            classes: cell.className,
            hasCursor: cell.classList.contains('cursor'),
            hasBgGray: cell.classList.contains('bg-gray'),
            hasCircleIcon: !!cell.querySelector('i.ri-checkbox-blank-circle-line'),
            hasCloseIcon: !!cell.querySelector('i.ri-close-line'),
            allIcons: Array.from(cell.querySelectorAll('i')).map(i => i.className),
            innerHTML: cell.innerHTML.substring(0, 100)
          });
        }
      }

      return { dates: Object.keys(data).length, slotCount, sampleDates: dates.slice(0, 3), sampleCells, sampleRows, timeMatchCount, rowCount: rows.length };
    });
    results.tableData = tableData;
    results.steps.push({ step: 'data_extracted', time: Date.now() - startTime });

    await browser.close();
    results.success = true;
    results.totalTime = Date.now() - startTime;
    res.json(results);
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    results.success = false;
    results.error = error.message;
    results.totalTime = Date.now() - startTime;
    res.status(500).json(results);
  }
});

// API: サウナヨーガン専用デバッグエンドポイント
app.get('/api/debug/yogan', async (req, res) => {
  const puppeteer = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());

  const startTime = Date.now();
  const results = { steps: [], errors: [] };

  let browser;
  try {
    results.steps.push({ step: 'start', time: 0 });

    // ブラウザ起動（stealth plugin付き）
    const isCloudRun = !!process.env.K_SERVICE;
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,900'
      ]
    };
    if (isCloudRun) {
      launchOptions.executablePath = '/usr/bin/chromium';
    }
    results.launchOptions = launchOptions;
    results.isCloudRun = isCloudRun;

    browser = await puppeteer.launch(launchOptions);
    results.steps.push({ step: 'browser_launched', time: Date.now() - startTime });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    results.steps.push({ step: 'page_created', time: Date.now() - startTime });

    const url = 'https://reserva.be/saunayogan/reserve?mode=service_staff&search_evt_no=eeeJyzMDY2MQIAAxwBBQ';
    results.url = url;

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
    results.steps.push({ step: 'page_loaded', time: Date.now() - startTime });

    // Cloudflareチャレンジ確認
    const pageTitle = await page.title();
    const pageContent = await page.content();
    results.pageTitle = pageTitle;

    const isChallenge =
      pageTitle.includes('Just a moment') ||
      pageTitle.includes('Cloudflare') ||
      pageTitle.includes('しばらくお待ちください') ||
      pageContent.includes('Checking your browser') ||
      pageContent.includes('cf-browser-verification');
    results.isCloudflareChallenge = isChallenge;
    results.steps.push({ step: 'cloudflare_check', time: Date.now() - startTime });

    // 追加待機（Cloudflareチャレンジ通過のため）
    if (isChallenge) {
      await new Promise(r => setTimeout(r, 10000));
      const newTitle = await page.title();
      results.afterWaitTitle = newTitle;
      results.steps.push({ step: 'wait_10s_for_challenge', time: Date.now() - startTime });
    }

    // ページ情報取得
    await new Promise(r => setTimeout(r, 5000));

    const calendarInfo = await page.evaluate(() => {
      const allInputs = document.querySelectorAll('input[name="userselect_date"]');
      const availableInputs = document.querySelectorAll('input[name="userselect_date"][data-targetdate]:not(.is-unavailable)');
      const unavailableInputs = document.querySelectorAll('input[name="userselect_date"].is-unavailable');

      const availableDates = Array.from(availableInputs).map(input => input.dataset.targetdate);

      return {
        allInputCount: allInputs.length,
        availableCount: availableInputs.length,
        unavailableCount: unavailableInputs.length,
        availableDates: availableDates.slice(0, 10),
        bodyLength: document.body.innerHTML.length,
        hasCalendar: allInputs.length > 0
      };
    });
    results.calendarInfo = calendarInfo;
    results.steps.push({ step: 'calendar_analysis', time: Date.now() - startTime });

    // スクリーンショット情報（HTMLの一部）
    const htmlSnippet = await page.evaluate(() => {
      return document.body.innerHTML.substring(0, 500);
    });
    results.htmlSnippet = htmlSnippet;

    await browser.close();
    results.steps.push({ step: 'browser_closed', time: Date.now() - startTime });

    results.success = true;
    results.totalTime = Date.now() - startTime;
    res.json(results);
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    results.success = false;
    results.error = error.message;
    results.totalTime = Date.now() - startTime;
    res.status(500).json(results);
  }
});

// API: 脈専用デバッグエンドポイント
app.get('/api/debug/myaku', async (req, res) => {
  const puppeteerExtra = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteerExtra.use(StealthPlugin());
  const startTime = Date.now();
  const results = { steps: [], errors: [] };

  let browser;
  try {
    results.steps.push({ step: 'start', time: 0 });

    // ブラウザ起動（stealthプラグイン付き）
    const isCloudRun = !!process.env.K_SERVICE;
    const launchOptions = {
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    };
    if (isCloudRun) {
      launchOptions.executablePath = '/usr/bin/chromium';
    }

    browser = await puppeteerExtra.launch(launchOptions);
    results.steps.push({ step: 'browser_launched', time: Date.now() - startTime });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    await page.setViewport({ width: 1280, height: 900 });
    results.steps.push({ step: 'page_created', time: Date.now() - startTime });

    // パラメータなしでアクセス（パラメータ付きだとプランが表示されない）
    const url = 'https://spot-ly.jp/ja/hotels/176';

    results.url = url;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    results.steps.push({ step: 'page_loaded', time: Date.now() - startTime });

    // react-select要素が表示されるまで待機（最大20秒）
    try {
      await page.waitForFunction(() => {
        return document.querySelectorAll('[class*="singleValue"]').length > 0 ||
               document.querySelectorAll('input[id^="react-select"]').length > 0;
      }, { timeout: 20000 });
      results.steps.push({ step: 'react_select_found', time: Date.now() - startTime });
    } catch (e) {
      results.steps.push({ step: 'react_select_timeout', time: Date.now() - startTime, error: e.message });
    }

    // ページ情報取得
    const pageTitle = await page.title();
    results.pageTitle = pageTitle;

    // スクロールして全プランを読み込み
    await page.evaluate(() => window.scrollTo(0, 1000));
    await new Promise(r => setTimeout(r, 1000));
    await page.evaluate(() => window.scrollTo(0, 2000));
    await new Promise(r => setTimeout(r, 1000));
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 1000));

    const planCheck = await page.evaluate(() => {
      // HTML内の特定のキーワードを検索
      const html = document.body.innerHTML;
      return {
        hasKYU: document.body.innerText.includes('KYU'),
        hasMIZU: document.body.innerText.includes('MIZU'),
        hasHI: document.body.innerText.includes('火 HI'),
        has0mei: document.body.innerText.includes('0名'),
        has1mei: document.body.innerText.includes('1名'),
        hasAdult: document.body.innerText.includes('大人'),
        controlCount: document.querySelectorAll('[class*="-control"]').length,
        inputCount: document.querySelectorAll('input[id^="react-select"]').length,
        singleValueCount: document.querySelectorAll('[class*="singleValue"]').length,
        selectCount: document.querySelectorAll('select').length,
        // クラス名にcssを含む要素（react-selectはcss-xxxという形式）
        cssClassCount: document.querySelectorAll('[class*="css-"]').length,
        htmlSample: html.substring(0, 500)
      };
    });
    results.planCheck = planCheck;
    results.steps.push({ step: 'plan_check', time: Date.now() - startTime });

    // ドロップダウン操作テスト
    const dropdownTest = await page.evaluate(() => {
      const controls = document.querySelectorAll('[class*="-control"]');
      if (controls[0]) {
        controls[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        return { clicked: true, controlCount: controls.length };
      }
      return { clicked: false, controlCount: 0 };
    });
    results.dropdownTest = dropdownTest;
    await new Promise(r => setTimeout(r, 500));

    // オプション確認
    const optionsCheck = await page.evaluate(() => {
      const opts = document.querySelectorAll('[class*="-option"]');
      return {
        optionCount: opts.length,
        options: Array.from(opts).map(o => o.textContent.trim())
      };
    });
    results.optionsCheck = optionsCheck;
    results.steps.push({ step: 'dropdown_test', time: Date.now() - startTime });

    // ボタン情報取得
    const buttonInfo = await page.evaluate(() => {
      const allButtons = document.querySelectorAll('button');
      const reserveButtons = [];

      allButtons.forEach((btn, idx) => {
        if (btn.innerText.trim() === '予約する') {
          reserveButtons.push({
            idx,
            classes: btn.className.substring(0, 80),
            text: btn.innerText.substring(0, 20)
          });
        }
      });

      return {
        totalButtons: allButtons.length,
        reserveButtonsFound: reserveButtons.length,
        reserveButtons: reserveButtons.slice(0, 10)
      };
    });
    results.buttonInfo = buttonInfo;
    results.steps.push({ step: 'button_analysis', time: Date.now() - startTime });

    // HTML長さ確認
    const htmlLength = await page.evaluate(() => document.body.innerHTML.length);
    results.htmlLength = htmlLength;

    // スクリーンショットをBase64で取得
    await page.evaluate(() => window.scrollTo(0, 600));
    const screenshotBuffer = await page.screenshot({ encoding: 'base64' });
    results.screenshot = `data:image/png;base64,${screenshotBuffer}`;

    await browser.close();
    results.steps.push({ step: 'browser_closed', time: Date.now() - startTime });

    results.success = true;
    results.totalTime = Date.now() - startTime;
    res.json(results);
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    results.success = false;
    results.error = error.message;
    results.totalTime = Date.now() - startTime;
    res.status(500).json(results);
  }
});

// API: GIRAFFE専用デバッグエンドポイント
app.get('/api/debug/giraffe', async (req, res) => {
  const puppeteer = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
  const flaresolverr = require('./flaresolverr');

  const startTime = Date.now();
  const results = { steps: [], errors: [] };

  let browser;
  try {
    results.steps.push({ step: 'start', time: 0 });

    // FlareSolverr Cookie取得
    let cfData = null;
    const isFlareSolverrAvailable = await flaresolverr.isAvailable();
    results.flareSolverrAvailable = isFlareSolverrAvailable;

    if (isFlareSolverrAvailable) {
      try {
        cfData = await flaresolverr.getPageHtml('https://reserva.be/giraffe_minamitenjin', 60000);
        results.cfCookieCount = cfData?.cookies?.length || 0;
        results.steps.push({ step: 'flaresolverr_cookies', time: Date.now() - startTime });
      } catch (e) {
        results.errors.push({ step: 'flaresolverr', error: e.message });
      }
    }

    // ブラウザ起動
    const isCloudRun = !!process.env.K_SERVICE;
    const launchOptions = {
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled']
    };
    if (isCloudRun) {
      launchOptions.executablePath = '/usr/bin/chromium';
    }
    results.isCloudRun = isCloudRun;

    browser = await puppeteer.launch(launchOptions);
    results.steps.push({ step: 'browser_launched', time: Date.now() - startTime });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // FlareSolverr Cookieを設定
    if (cfData?.cookies && cfData.cookies.length > 0) {
      const puppeteerCookies = cfData.cookies.map(cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain || '.reserva.be',
        path: cookie.path || '/'
      }));
      await page.setCookie(...puppeteerCookies);
      results.steps.push({ step: 'cookies_set', time: Date.now() - startTime });
    }

    // GIRAFFEページにアクセス（最初の部屋）
    const url = 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=91eJwzNDAyszAGAAQpATU&ctg_no=05eJwzMjQ2NgIAAvQA_A';
    results.url = url;

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
    results.steps.push({ step: 'page_loaded', time: Date.now() - startTime });

    // Cloudflareチャレンジ確認
    const pageTitle = await page.title();
    results.pageTitle = pageTitle;
    results.isCloudflareChallenge = pageTitle.includes('Just a moment') || pageTitle === '';
    results.steps.push({ step: 'cloudflare_check', time: Date.now() - startTime });

    // 待機
    await new Promise(r => setTimeout(r, 5000));

    // input.timebox要素を確認
    const timeboxInfo = await page.evaluate(() => {
      const allTimeboxes = document.querySelectorAll('input.timebox');
      const vacantTimeboxes = document.querySelectorAll('input.timebox[data-vacancy="1"]');

      const samples = Array.from(vacantTimeboxes).slice(0, 5).map(input => ({
        targetgroup: input.dataset.targetgroup,
        time: input.dataset.time,
        vacancy: input.dataset.vacancy
      }));

      return {
        totalTimeboxCount: allTimeboxes.length,
        vacantTimeboxCount: vacantTimeboxes.length,
        samples
      };
    });
    results.timeboxInfo = timeboxInfo;
    results.steps.push({ step: 'timebox_analysis', time: Date.now() - startTime });

    await browser.close();
    results.steps.push({ step: 'browser_closed', time: Date.now() - startTime });

    results.success = true;
    results.totalTime = Date.now() - startTime;
    res.json(results);
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    results.success = false;
    results.error = error.message;
    results.totalTime = Date.now() - startTime;
    res.status(500).json(results);
  }
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);

  // 起動時に初回スクレイピング実行（setImmediateで遅延実行し、Expressコールバック外で実行）
  setImmediate(async () => {
    console.log('初回スクレイピング開始...');
    try {
      await scrapeAll();
      console.log('初回スクレイピング完了');
    } catch (error) {
      console.error('初回スクレイピングエラー:', error.message);
    }
  });
});
