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
  
  // 天神店の See details をクリック（座標指定）
  // 2番目の See details ボタンをクリック
  console.log('天神店 See details をクリック...');
  
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('span'));
    let count = 0;
    for (const btn of buttons) {
      if (btn.textContent.trim() === 'See details') {
        count++;
        if (count === 2) { // 2番目がTenjin
          btn.click();
          return 'clicked 2nd See details';
        }
      }
    }
    return 'not found';
  });
  console.log(clicked);
  
  await new Promise(r => setTimeout(r, 3000));
  
  // ポップアップ内のリンクを取得
  const popupLinks = await page.evaluate(() => {
    // モーダル/ポップアップ内のリンクを探す
    const modal = document.querySelector('.modal, [class*="modal"], [class*="popup"], [role="dialog"]');
    if (modal) {
      const links = Array.from(modal.querySelectorAll('a'));
      return links.map(l => ({ text: l.textContent.trim(), href: l.href }));
    }
    
    // 全体から探す
    const allLinks = Array.from(document.querySelectorAll('a'));
    return allLinks
      .filter(l => l.href.includes('evt_no') || l.href.includes('ctg_no'))
      .map(l => ({ text: l.textContent.trim().substring(0, 80), href: l.href }));
  });
  
  console.log('\nポップアップ/ページ内リンク:');
  popupLinks.forEach(l => console.log(`  ${l.text}: ${l.href}`));
  
  // スクリーンショット
  await page.screenshot({ path: '/tmp/tenjin_popup.png', fullPage: true });
  console.log('\nスクリーンショット: /tmp/tenjin_popup.png');
  
  // ポップアップ内のテキストを取得
  const pageText = await page.evaluate(() => document.body.innerText);
  if (pageText.includes('陰') || pageText.includes('陽')) {
    console.log('\n陰/陽 が見つかりました');
    const match = pageText.match(/陰[^]*陽/);
    if (match) console.log(match[0].substring(0, 500));
  }
  
  await browser.close();
}

test().catch(console.error);
