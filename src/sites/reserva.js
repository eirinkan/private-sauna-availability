/**
 * GIRAFFE (RESERVA) スクレイパー
 * 南天神店・天神店の両方を取得
 */

// 南天神店の部屋URL
const MINAMI_TENJIN_URLS = [
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=88eJwzNDAyszACAAQoATQ&ctg_no=05eJwzMjQ2NgIAAvQA_A',
    defaultName: '南天神 Room 1'
  },
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=91eJwzNDAyszAGAAQpATU&ctg_no=05eJwzMjQ2NgIAAvQA_A',
    defaultName: '南天神 Room 2'
  },
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=72eJyzNDcztgQAAz8BEw&ctg_no=5aeJwzMjQyMAQAAuoA9w',
    defaultName: '南天神 Room 3'
  },
  {
    url: 'https://reserva.be/giraffe_minamitenjin/reserve?mode=service_staff&search_evt_no=4feJyzNLcwMAIAAzgBCw&ctg_no=5aeJwzMjQyMAQAAuoA9w',
    defaultName: '南天神 Room 4'
  }
];

// 天神店のURL（カテゴリパラメータで天神店を指定）
const TENJIN_BASE_URL = 'https://reserva.be/giraffe_minamitenjin?ctg_no=05eJwzMjQ2NgIAAvQA_A';

// 南天神店のスクレイピング
async function scrapeMinamiTenjin(browser) {
  const result = { dates: {} };

  for (const room of MINAMI_TENJIN_URLS) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    try {
      await page.goto(room.url, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(resolve => setTimeout(resolve, 3000));

      const roomData = await page.evaluate((defaultName) => {
        const titleEl = document.querySelector('h3.menu-detail__title');
        const roomName = titleEl ? titleEl.textContent.trim() : defaultName;

        const bodyText = document.body.innerText;
        const monthMatch = bodyText.match(/(\d{4})年(\d{1,2})月/);
        const year = monthMatch ? monthMatch[1] : new Date().getFullYear();
        const month = monthMatch ? monthMatch[2].padStart(2, '0') : (new Date().getMonth() + 1).toString().padStart(2, '0');

        const timeElements = Array.from(document.querySelectorAll('*'))
          .filter(el => {
            const text = el.textContent.trim();
            return /^\d{1,2}:\d{2}$/.test(text) || /^\d{1,2}時/.test(text);
          })
          .map(el => el.textContent.trim());

        const hasAvailability = document.querySelector('[class*="reserve"], button[class*="available"]') !== null;

        return {
          roomName,
          year,
          month,
          timeSlots: [...new Set(timeElements)],
          hasAvailability,
          rawText: bodyText.substring(0, 2000)
        };
      }, room.defaultName);

      const roomName = roomData.roomName;
      const today = new Date();

      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];

        if (!result.dates[dateStr]) {
          result.dates[dateStr] = {};
        }
        result.dates[dateStr][roomName] = roomData.hasAvailability ? roomData.timeSlots : [];
      }

    } catch (error) {
      console.error(`GIRAFFE ${room.defaultName} エラー:`, error.message);
    } finally {
      await page.close();
    }
  }

  return result;
}

// 天神店のスクレイピング
async function scrapeTenjin(browser) {
  const result = { dates: {} };
  const page = await browser.newPage();

  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  try {
    await page.goto(TENJIN_BASE_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 天神店のメニュー一覧から部屋情報を取得
    const rooms = await page.evaluate(() => {
      const menuItems = document.querySelectorAll('.menu-item, [class*="service-item"], .card');
      const roomList = [];

      menuItems.forEach(item => {
        const titleEl = item.querySelector('h3, .menu-title, [class*="title"]');
        if (titleEl) {
          const name = titleEl.textContent.trim();
          // 陰・陽のサウナタイプを識別
          if (name.includes('陰') || name.includes('陽') || name.includes('サウナ')) {
            roomList.push(name);
          }
        }
      });

      // メニュー一覧から時間枠も取得
      const timeElements = Array.from(document.querySelectorAll('*'))
        .filter(el => /^\d{1,2}:\d{2}$/.test(el.textContent.trim()))
        .map(el => el.textContent.trim());

      return {
        rooms: [...new Set(roomList)],
        timeSlots: [...new Set(timeElements)]
      };
    });

    // 部屋が見つからない場合はデフォルト
    const roomNames = rooms.rooms.length > 0 ? rooms.rooms : ['陰（静の陰影）', '陽（動の陽光）'];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];

      if (!result.dates[dateStr]) {
        result.dates[dateStr] = {};
      }

      for (const roomName of roomNames) {
        result.dates[dateStr][roomName] = rooms.timeSlots;
      }
    }

  } catch (error) {
    console.error('GIRAFFE天神 エラー:', error.message);
  } finally {
    await page.close();
  }

  return result;
}

// メインのscrape関数（両店舗をまとめて返す）
async function scrape(browser) {
  return scrapeMinamiTenjin(browser);
}

// 天神店用のscrape関数
async function scrapeTenjinStore(browser) {
  return scrapeTenjin(browser);
}

module.exports = { scrape, scrapeTenjinStore };
