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
  
  // 天神店カテゴリURLにアクセス
  const tenjinUrl = 'https://reserva.be/giraffe_minamitenjin?ctg_no=5aeJwzMjQyMAQAAuoA9w';
  console.log('天神店カテゴリURL:', tenjinUrl);
  
  await page.goto(tenjinUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));
  
  // スクリーンショット保存
  await page.screenshot({ path: '/tmp/tenjin_category.png', fullPage: true });
  console.log('スクリーンショット保存: /tmp/tenjin_category.png');
  
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
  
  // 現在のURL
  console.log('現在のURL:', page.url());
  
  await browser.close();
}

test().catch(console.error);
