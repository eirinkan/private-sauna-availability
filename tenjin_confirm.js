const puppeteer = require('puppeteer');
const axios = require('axios');

async function test() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await page.setViewport({ width: 1280, height: 800 });
  
  // FlareSolverr Cookie取得
  try {
    const response = await axios.post('http://localhost:8191/v1', {
      cmd: 'request.get',
      url: 'https://reserva.be/giraffe_minamitenjin',
      maxTimeout: 60000
    }, { timeout: 70000 });
    
    if (response.data.status === 'ok') {
      const cookies = response.data.solution.cookies;
      const puppeteerCookies = cookies.map(c => ({
        name: c.name, value: c.value, domain: c.domain || '.reserva.be', path: c.path || '/'
      }));
      await page.setCookie(...puppeteerCookies);
    }
  } catch (e) {}
  
  // メインページにアクセス
  await page.goto('https://reserva.be/giraffe_minamitenjin', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));
  
  // 天神店のラジオボタンをクリック
  console.log('天神店を選択...');
  await page.evaluate(() => {
    // 2番目のラジオボタン（天神店）を探す
    const radios = document.querySelectorAll('input[type="radio"]');
    console.log('radios found:', radios.length);
    if (radios.length >= 2) {
      radios[1].click();
    }
    
    // または label をクリック
    const items = document.querySelectorAll('[class*="category__item"]');
    if (items.length >= 2) {
      items[1].click();
    }
  });
  
  await new Promise(r => setTimeout(r, 1000));
  
  // Confirmボタンをクリック
  console.log('Confirmをクリック...');
  await page.evaluate(() => {
    const confirm = document.querySelector('a.decision, a[class*="decision"]');
    if (confirm) {
      console.log('Confirm found:', confirm.href);
      confirm.click();
    }
  });
  
  // ページ遷移を待つ
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));
  
  console.log('現在のURL:', page.url());
  
  // 部屋リンクを探す
  const roomLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    return links
      .filter(l => l.href && l.href.includes('search_evt_no'))
      .map(l => ({ 
        text: l.textContent.trim().substring(0, 100), 
        href: l.href 
      }));
  });
  
  console.log('\n見つかった部屋リンク:');
  roomLinks.forEach(r => console.log(`  ${r.text}\n    ${r.href}\n`));
  
  // スクリーンショット
  await page.screenshot({ path: '/tmp/tenjin_rooms.png', fullPage: true });
  
  await browser.close();
}

test().catch(console.error);
