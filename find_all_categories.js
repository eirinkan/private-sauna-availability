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
  
  // 天神店のラジオボタンを選択
  console.log('天神店を選択...');
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    for (const label of labels) {
      if (label.textContent.includes('Tenjin (Chuo')) {
        const radio = label.querySelector('input[type="radio"]') || label.previousElementSibling;
        if (radio) radio.click();
        label.click();
        return true;
      }
    }
    // 2番目のラジオボタン
    const radios = document.querySelectorAll('input[type="radio"]');
    if (radios.length >= 2) {
      radios[1].click();
      return true;
    }
    return false;
  });
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Confirmボタンを探してクリック
  console.log('Confirmボタンをクリック...');
  await page.evaluate(() => {
    const confirms = Array.from(document.querySelectorAll('a, button'));
    for (const el of confirms) {
      if (el.textContent.includes('Confirm')) {
        el.click();
        return true;
      }
    }
    return false;
  });
  
  await new Promise(r => setTimeout(r, 5000));
  
  // 現在のURL
  console.log('Confirm後のURL:', page.url());
  
  // スクリーンショット
  await page.screenshot({ path: '/tmp/tenjin_after_confirm.png', fullPage: true });
  
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
  
  await browser.close();
}

test().catch(console.error);
