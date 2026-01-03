const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// 各サイトのスクレイパー
const sakurado = require('./sites/sakurado');
const reserva = require('./sites/reserva');
const hacomono = require('./sites/hacomono');
const gflow = require('./sites/gflow');
const coubic = require('./sites/coubic');

const DATA_FILE = path.join(__dirname, '../data/availability.json');

// キャッシュデータの読み込み
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('データ読み込みエラー:', error.message);
  }
  return { lastUpdated: null, facilities: {} };
}

// キャッシュデータの保存
function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('データ保存エラー:', error.message);
  }
}

// Puppeteerブラウザ起動（共通設定）
async function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });
}

// 全サイトスクレイピング
async function scrapeAll() {
  const browser = await launchBrowser();
  const data = loadData();
  data.lastUpdated = new Date().toISOString();
  data.facilities = {};

  try {
    // SAKURADO
    console.log('  - SAKURADO スクレイピング中...');
    try {
      data.facilities.sakurado = await sakurado.scrape(browser);
    } catch (e) {
      console.error('    SAKURADO エラー:', e.message);
      data.facilities.sakurado = { error: e.message };
    }

    // GIRAFFE (RESERVA)
    console.log('  - GIRAFFE スクレイピング中...');
    try {
      data.facilities.giraffe = await reserva.scrape(browser);
    } catch (e) {
      console.error('    GIRAFFE エラー:', e.message);
      data.facilities.giraffe = { error: e.message };
    }

    // KUDOCHI (hacomono)
    console.log('  - KUDOCHI スクレイピング中...');
    try {
      data.facilities.kudochi = await hacomono.scrape(browser);
    } catch (e) {
      console.error('    KUDOCHI エラー:', e.message);
      data.facilities.kudochi = { error: e.message };
    }

    // SAUNA OOO (gflow)
    console.log('  - SAUNA OOO スクレイピング中...');
    try {
      data.facilities.saunaOoo = await gflow.scrape(browser);
    } catch (e) {
      console.error('    SAUNA OOO エラー:', e.message);
      data.facilities.saunaOoo = { error: e.message };
    }

    // BASE (Coubic)
    console.log('  - BASE スクレイピング中...');
    try {
      data.facilities.base = await coubic.scrape(browser);
    } catch (e) {
      console.error('    BASE エラー:', e.message);
      data.facilities.base = { error: e.message };
    }

    saveData(data);
    return data;
  } finally {
    await browser.close();
  }
}

// 指定日の空き状況を取得
function getAvailability(date) {
  const data = loadData();
  const result = {
    date,
    lastUpdated: data.lastUpdated,
    facilities: []
  };

  // 各施設のデータを整形
  const facilityInfo = [
    { key: 'sakurado', name: 'SAUNA SAKURADO', url: 'https://sauna-sakurado.spa/reservation/' },
    { key: 'giraffe', name: 'GIRAFFE南天神', url: 'https://reserva.be/giraffe_minamitenjin' },
    { key: 'kudochi', name: 'KUDOCHI福岡中洲', url: 'https://kudochi-sauna.hacomono.jp/' },
    { key: 'saunaOoo', name: 'SAUNA OOO FUKUOKA', url: 'https://sw.gflow.cloud/ooo-fukuoka/calendar_open' },
    { key: 'base', name: 'BASE Private sauna', url: 'https://coubic.com/base-private-sauna' }
  ];

  for (const info of facilityInfo) {
    const facilityData = data.facilities?.[info.key] || {};

    if (facilityData.error) {
      result.facilities.push({
        name: info.name,
        url: info.url,
        error: facilityData.error,
        rooms: []
      });
      continue;
    }

    // 指定日のデータを抽出
    const dayData = facilityData.dates?.[date] || {};
    const rooms = [];

    for (const [roomName, slots] of Object.entries(dayData)) {
      rooms.push({
        name: roomName,
        availableSlots: slots || []
      });
    }

    result.facilities.push({
      name: info.name,
      url: info.url,
      rooms
    });
  }

  return result;
}

module.exports = { scrapeAll, getAvailability };
