const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Stealth pluginを有効化（ボット検出回避）
puppeteer.use(StealthPlugin());

// 各サイトのスクレイパー
const sakurado = require('./sites/sakurado');
const reserva = require('./sites/reserva');
const hacomono = require('./sites/hacomono');
const gflow = require('./sites/gflow');
const coubic = require('./sites/coubic');
const myaku = require('./sites/myaku');
const yogan = require('./sites/yogan');

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

    // GIRAFFE 南天神 (RESERVA)
    console.log('  - GIRAFFE南天神 スクレイピング中...');
    try {
      data.facilities.giraffeMiamitenjin = await reserva.scrapeMiamitenjin(browser);
    } catch (e) {
      console.error('    GIRAFFE南天神 エラー:', e.message);
      data.facilities.giraffeMiamitenjin = { error: e.message };
    }

    // GIRAFFE 天神 (RESERVA)
    console.log('  - GIRAFFE天神 スクレイピング中...');
    try {
      data.facilities.giraffeTenjin = await reserva.scrapeTenjin(browser);
    } catch (e) {
      console.error('    GIRAFFE天神 エラー:', e.message);
      data.facilities.giraffeTenjin = { error: e.message };
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

    // 脈 (spot-ly)
    console.log('  - 脈 スクレイピング中...');
    try {
      data.facilities.myaku = await myaku.scrape(browser);
    } catch (e) {
      console.error('    脈 エラー:', e.message);
      data.facilities.myaku = { error: e.message };
    }

    // サウナヨーガン (reserva.be)
    console.log('  - サウナヨーガン スクレイピング中...');
    try {
      data.facilities.yogan = await yogan.scrape(browser);
    } catch (e) {
      console.error('    サウナヨーガン エラー:', e.message);
      data.facilities.yogan = { error: e.message };
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

  // 各施設のデータを整形（KUDOCHIを一番上に）
  const facilityInfo = [
    { key: 'kudochi', name: 'KUDOCHI福岡中洲', url: 'https://kudochi-sauna.hacomono.jp/reserve/schedule/6/25', hpUrl: 'https://kudochi.jp/nakasu/', mapUrl: 'https://www.google.com/maps/search/?api=1&query=KUDOCHI+福岡中洲' },
    { key: 'sakurado', name: 'SAUNA SAKURADO', url: 'https://sauna-sakurado.spa/reservation/', hpUrl: 'https://sauna-sakurado.spa/', mapUrl: 'https://www.google.com/maps/search/?api=1&query=SAUNA+SAKURADO+福岡' },
    { key: 'giraffeMiamitenjin', name: 'GIRAFFE 天神', url: 'https://reserva.be/giraffe_minamitenjin', hpUrl: 'https://giraffe-sauna.com/', mapUrl: 'https://maps.app.goo.gl/jzrDoYaTVege5srB6' },
    { key: 'giraffeTenjin', name: 'GIRAFFE 南天神', url: 'https://reserva.be/giraffe_minamitenjin', hpUrl: 'https://giraffe-sauna.com/', mapUrl: 'https://maps.app.goo.gl/nAnPLjANSzuPVeLZA' },
    { key: 'saunaOoo', name: 'SAUNA OOO FUKUOKA', url: 'https://sw.gflow.cloud/ooo-fukuoka/calendar_open', hpUrl: 'https://sauna-ooo.com/', mapUrl: 'https://www.google.com/maps/search/?api=1&query=SAUNA+OOO+FUKUOKA' },
    { key: 'base', name: 'BASE Private sauna', url: 'https://coubic.com/base-private-sauna/3957380/book/course_type', hpUrl: 'https://www.instagram.com/base_privatesauna/', mapUrl: 'https://www.google.com/maps/search/?api=1&query=BASE+Private+sauna+福岡' },
    { key: 'myaku', name: '脈 MYAKU', url: 'https://spot-ly.jp/ja/hotels/176', hpUrl: 'https://myaku-sauna.com/', mapUrl: 'https://www.google.com/maps/search/?api=1&query=脈+MYAKU+サウナ+天神' },
    { key: 'yogan', name: 'サウナヨーガン福岡天神', url: 'https://reserva.be/saunayogan/reserve?mode=service_staff&search_evt_no=eeeJyzMDY2MQIAAxwBBQ', hpUrl: 'https://www.saunayogan.jp/', mapUrl: 'https://www.google.com/maps/search/?api=1&query=サウナヨーガン+福岡天神' }
  ];

  for (const info of facilityInfo) {
    const facilityData = data.facilities?.[info.key] || {};

    if (facilityData.error) {
      result.facilities.push({
        name: info.name,
        url: info.url,
        hpUrl: info.hpUrl,
        mapUrl: info.mapUrl,
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
      hpUrl: info.hpUrl,
      mapUrl: info.mapUrl,
      rooms
    });
  }

  return result;
}

module.exports = { scrapeAll, getAvailability };
