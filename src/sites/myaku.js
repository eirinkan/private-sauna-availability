/**
 * 脈 -MYAKU PRIVATE SAUNA- (spot-ly) スクレイパー
 * URL: https://spot-ly.jp/ja/hotels/176
 *
 * カレンダーの◯✕マークから空き状況を直接取得
 *
 * DOM構造:
 * <div class="flex divide-x divide-gray-300 tracking-wide">
 *   <div class="flex-1 text-center py-2">
 *     <div class="text-xs">1/11</div>
 *     <div class="text-lg">✕</div> or <div class="text-lg">◯</div>
 *   </div>
 *   ...7日分
 * </div>
 *
 * カレンダーの順序（ページ上から下）:
 * 0: 休 KYU 90分午後
 * 1: 水 MIZU ナイトパック
 * 2: 水 MIZU 90分午後
 * 3: 水 MIZU 90分午前
 * 4: 火 HI ナイトパック
 * 5: 火 HI 90分午後
 * 6: 火 HI 90分午前
 */

const { chromium } = require('playwright');

const BASE_URL = 'https://spot-ly.jp/ja/hotels/176';

// プラン情報（ページ上の表示順）
const PLANS = [
  {
    name: '休 KYU（90分/定員3名）¥9,130〜',
    timeSlots: ['11:30〜13:00', '13:30〜15:00', '15:30〜17:00', '17:30〜19:00', '19:30〜21:00'],
  },
  {
    name: '水 MIZU（night/定員2名）¥8,800〜',
    timeSlots: ['1:00〜8:30'],
    isNight: true,
  },
  {
    name: '水 MIZU（90分午後/定員2名）¥6,600〜',
    timeSlots: ['13:00〜14:30', '15:00〜16:30', '17:00〜18:30', '19:00〜20:30', '21:00〜22:30', '23:00〜0:30'],
  },
  {
    name: '水 MIZU（90分午前/定員2名）¥6,600〜',
    timeSlots: ['9:00〜10:30', '11:00〜12:30'],
  },
  {
    name: '火 HI（night/定員4名）¥10,120〜',
    timeSlots: ['0:30〜8:00'],
    isNight: true,
  },
  {
    name: '火 HI（90分午後/定員4名）¥7,150〜',
    timeSlots: ['14:30〜16:00', '16:30〜18:00', '18:30〜20:00', '20:30〜22:00', '22:30〜0:00'],
  },
  {
    name: '火 HI（90分午前/定員4名）¥7,150〜',
    timeSlots: ['8:30〜10:00', '10:30〜12:00', '12:30〜14:00'],
  }
];

async function scrape(puppeteerBrowser) {
  // Playwright独自のブラウザを起動
  // Cloud Run環境ではシステムのchromiumを使用
  const isCloudRun = process.env.K_SERVICE !== undefined;
  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  };

  // Cloud Run環境ではシステムのchromiumパスを指定
  if (isCloudRun) {
    launchOptions.executablePath = '/usr/bin/chromium';
  }

  const browser = await chromium.launch(launchOptions);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }
  });

  const page = await context.newPage();

  try {
    console.log('    → 脈: Playwrightでアクセス中...');

    const result = { dates: {} };
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // 日付パラメータ付きURLに直接アクセス
    const checkinDate = now.toISOString().split('T')[0];
    const checkoutDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const directUrl = `${BASE_URL}?checkinDatetime=${checkinDate}+00%3A00%3A00&checkoutDatetime=${checkoutDate}+00%3A00%3A00`;

    console.log('    → 脈: 空室状況ページに直接アクセス');
    await page.goto(directUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    // ページの読み込み確認
    const pageTitle = await page.title();
    console.log(`    → 脈: ページタイトル = "${pageTitle}"`);

    // カレンダーから空き状況を取得
    const calendars = await page.evaluate(() => {
      const containers = document.querySelectorAll('div');
      const results = [];

      for (const div of containers) {
        const cls = div.className || '';
        // flex divide-x divide-gray クラスを持つコンテナを探す
        if (cls.indexOf('divide-x') >= 0 && cls.indexOf('divide-gray') >= 0) {
          const children = div.querySelectorAll(':scope > div');
          // 8日分のカレンダー（または7日分）
        if (children.length >= 7 && children.length <= 8) {
            const firstChildText = children[0].innerText || '';
            // 日付を含むもののみ（1/11のような形式）
            if (firstChildText.indexOf('/') >= 0) {
              const calendarData = [];
              for (const child of children) {
                const text = child.innerText || '';
                const parts = text.split('\n');
                if (parts.length >= 2) {
                  const dateText = parts[0].trim();
                  const status = parts[1].trim();
                  // 日付をパース
                  const dateMatch = dateText.match(/(\d+)\/(\d+)/);
                  if (dateMatch) {
                    calendarData.push({
                      month: parseInt(dateMatch[1]),
                      day: parseInt(dateMatch[2]),
                      available: status === '\u25EF' || status === '\u25CB' || status === 'O' || status === '\u3007'
                    });
                  }
                }
              }
              if (calendarData.length >= 7) {
                results.push(calendarData);
              }
            }
          }
        }
      }

      return results;
    });

    console.log(`    → 脈: ${calendars.length}件のカレンダーを取得`);

    // 結果を整理
    for (let planIndex = 0; planIndex < Math.min(calendars.length, PLANS.length); planIndex++) {
      const calendar = calendars[planIndex];
      const plan = PLANS[planIndex];

      const availableCount = calendar.filter(d => d.available).length;
      console.log(`    → ${plan.name}: ${availableCount}/${calendar.length}日空き`);

      for (const dateInfo of calendar) {
        if (dateInfo.available) {
          let month = dateInfo.month;
          let year = currentYear;

          // 年の調整（12月→1月の場合）
          if (month < currentMonth - 1) {
            year++;
          }

          let dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dateInfo.day).padStart(2, '0')}`;

          // ナイトパックは前日の日付にする
          if (plan.isNight) {
            const d = new Date(dateStr);
            d.setDate(d.getDate() - 1);
            dateStr = d.toISOString().split('T')[0];
          }

          if (!result.dates[dateStr]) {
            result.dates[dateStr] = {};
          }
          if (!result.dates[dateStr][plan.name]) {
            result.dates[dateStr][plan.name] = [];
          }

          // 時間帯を追加
          for (const slot of plan.timeSlots) {
            if (!result.dates[dateStr][plan.name].includes(slot)) {
              result.dates[dateStr][plan.name].push(slot);
            }
          }
        }
      }
    }

    console.log(`    → 脈: ${Object.keys(result.dates).length}日分のデータ取得`);
    return result;

  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}

module.exports = { scrape };
