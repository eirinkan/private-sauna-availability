/**
 * KUDOCHI福岡中洲 (hacomono) スクレイパー
 * URL: https://kudochi-sauna.hacomono.jp/
 *
 * 店舗選択ページから「福岡中洲店」を選択する必要あり
 * 部屋タイプ: スタンダード(2名)、スーペリア(3名)、セミVIP(4名)、VIP(6名)
 */

const URL = 'https://kudochi-sauna.hacomono.jp/';

async function scrape(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  try {
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 福岡中洲店を選択
    const clicked = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, button, div[onclick]'));
      for (const link of links) {
        if (link.textContent.includes('福岡中洲') || link.textContent.includes('FUKUOKANAKASU')) {
          link.click();
          return true;
        }
      }
      // テーブル内のリンクを探す
      const rows = document.querySelectorAll('tr');
      for (const row of rows) {
        if (row.textContent.includes('福岡') || row.textContent.includes('FUKUOKA')) {
          const clickable = row.querySelector('a, button');
          if (clickable) {
            clickable.click();
            return true;
          }
          row.click();
          return true;
        }
      }
      return false;
    });

    if (clicked) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    const result = { dates: {} };

    // スケジュールページを解析
    const scheduleData = await page.evaluate(() => {
      const data = {};

      // カレンダーを探す
      const calendar = document.querySelector('[class*="calendar"], [class*="schedule"], table');

      // 日付セルを探す
      const dateCells = Array.from(document.querySelectorAll('[class*="day"], td, th'))
        .filter(el => {
          const text = el.textContent.trim();
          return /^\d{1,2}$/.test(text) || /\d{1,2}\/\d{1,2}/.test(text);
        });

      // 予約可能枠を探す
      const availableSlots = Array.from(document.querySelectorAll('[class*="jz"], [class*="available"], [class*="open"]'))
        .filter(el => el.textContent.trim() !== '');

      // 満員枠
      const fullSlots = Array.from(document.querySelectorAll('[class*="full"], [class*="closed"]'));

      // ページ内容から情報を抽出
      const bodyText = document.body.innerText;

      // 時間枠パターンを検索
      const timeMatches = bodyText.match(/\d{1,2}:\d{2}/g) || [];

      return {
        availableCount: availableSlots.length,
        fullCount: fullSlots.length,
        dateCount: dateCells.length,
        times: [...new Set(timeMatches)].slice(0, 20),
        bodyText: bodyText.substring(0, 3000)
      };
    });

    // 簡易的に結果を構築（詳細な解析は要調整）
    const today = new Date();
    const roomTypes = ['スタンダード', 'スーペリア', 'セミVIP', 'VIP'];

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];

      result.dates[dateStr] = {};
      for (const room of roomTypes) {
        // 詳細な空き時間の取得は要調整
        result.dates[dateStr][room] = scheduleData.availableCount > 0 ? scheduleData.times.slice(0, 5) : [];
      }
    }

    return result;
  } finally {
    await page.close();
  }
}

module.exports = { scrape };
