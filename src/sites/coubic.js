/**
 * BASE Private sauna (Coubic) スクレイパー
 * URL: https://coubic.com/base-private-sauna/3957380/book
 *
 * 構造:
 * - メニュー選択 → コース選択 → 完了ボタンで日時選択画面が表示
 * - 空き枠はラジオボタンのvalue属性にISOタイムスタンプとして格納
 *   例: "2026-01-05T01:00:00.000Z" = 2026-01-05 10:00 JST
 * - ラジオボタンが存在する = 空きあり、存在しない = 空きなし
 * - 平日プランと土日プランを両方スクレイピングして統合
 */

const BOOKING_URL = 'https://coubic.com/base-private-sauna/3957380/book';

// コース種別（表示用）- 統一フォーマット：部屋名（時間/定員）価格
const COURSE_NAMES = ['BASE（120分/定員2名）¥6,500-10,800'];

// 日付が平日かどうか判定
function isWeekdayDate(dateStr) {
  const date = new Date(dateStr);
  const day = date.getDay();
  return day >= 1 && day <= 5; // 月〜金
}

// 1つのプランをスクレイピング
async function scrapePlan(page, planName) {
  // メニュー選択ボタンをクリック
  let menuClicked = false;
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && (text.includes('選択してください') || text.includes('変更'))) {
      await btn.click();
      menuClicked = true;
      break;
    }
  }

  if (!menuClicked) {
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const text = btn.textContent.trim();
        if (text.includes('選択してください') || text.includes('変更')) {
          btn.click();
          return;
        }
      }
    });
  }

  await new Promise(resolve => setTimeout(resolve, 3000));

  // ダイアログが開くのを待機
  try {
    await page.waitForSelector('dialog, [role="dialog"]', { timeout: 8000 });
  } catch (e) {
    // 再試行
    const retryButtons = await page.$$('button');
    for (const btn of retryButtons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.includes('選択してください')) {
        await btn.click();
        await new Promise(resolve => setTimeout(resolve, 3000));
        break;
      }
    }
  }
  await new Promise(resolve => setTimeout(resolve, 1000));

  // プラン選択
  await page.evaluate((plan) => {
    const radios = document.querySelectorAll('input[type="radio"]');
    for (const radio of radios) {
      const label = radio.closest('label');
      if (label && label.textContent.includes(plan)) {
        radio.click();
        return;
      }
    }
    const labels = document.querySelectorAll('label');
    for (const label of labels) {
      if (label.textContent.includes(plan)) {
        const input = label.querySelector('input');
        if (input) {
          input.click();
          return;
        }
        label.click();
        return;
      }
    }
  }, planName);
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 完了ボタンをクリック
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent.trim();
      if (text === '完了' || text === '決定' || text === 'OK') {
        btn.click();
        return;
      }
    }
  });

  // カレンダー読み込み待機
  try {
    await page.waitForSelector('input[name="dateTimeSelection"]', { timeout: 15000 });
  } catch (e) {
    await page.evaluate(() => window.scrollBy(0, 300));
    await new Promise(resolve => setTimeout(resolve, 3000));
    try {
      await page.waitForSelector('input[name="dateTimeSelection"]', { timeout: 10000 });
    } catch (e2) {
      // タイムアウト
    }
  }
  await new Promise(resolve => setTimeout(resolve, 3000));

  // ラジオボタンから空き枠を抽出
  const calendarData = await page.evaluate(() => {
    const availableSlots = {};
    const inputs = document.querySelectorAll('input');
    inputs.forEach(function(input) {
      const value = input.value;
      if (!value || value.indexOf('T') === -1) return;

      const datePart = value.split('T')[0];
      const timePart = value.split('T')[1];
      if (!datePart || !timePart) return;

      const dateParts = datePart.split('-');
      const timeParts = timePart.split(':');
      if (dateParts.length < 3 || timeParts.length < 2) return;

      const year = parseInt(dateParts[0]);
      const month = parseInt(dateParts[1]);
      const day = parseInt(dateParts[2]);
      const utcHour = parseInt(timeParts[0]);
      const utcMin = timeParts[1];

      // UTC → JST変換（+9時間）
      let jstHour = utcHour + 9;
      let jstDay = day;
      let jstMonth = month;
      let jstYear = year;

      if (jstHour >= 24) {
        jstHour = jstHour - 24;
        jstDay = jstDay + 1;
        const daysInMonth = new Date(jstYear, jstMonth, 0).getDate();
        if (jstDay > daysInMonth) {
          jstDay = 1;
          jstMonth = jstMonth + 1;
          if (jstMonth > 12) {
            jstMonth = 1;
            jstYear = jstYear + 1;
          }
        }
      }

      const pad = function(n) { return n < 10 ? '0' + n : '' + n; };
      const dateStr = jstYear + '-' + pad(jstMonth) + '-' + pad(jstDay);

      const startHour = jstHour;
      const startMin = parseInt(utcMin);
      let endMin = startMin + 120;
      let endHour = startHour;
      while (endMin >= 60) {
        endMin = endMin - 60;
        endHour = endHour + 1;
      }
      if (endHour >= 24) {
        endHour = endHour - 24;
      }

      const timeStr = pad(startHour) + ':' + pad(startMin) + '〜' + pad(endHour) + ':' + pad(endMin);

      if (!availableSlots[dateStr]) {
        availableSlots[dateStr] = [];
      }
      if (availableSlots[dateStr].indexOf(timeStr) === -1) {
        availableSlots[dateStr].push(timeStr);
      }
    });
    return availableSlots;
  });

  return calendarData;
}

async function scrape(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 900 });

  try {
    const result = { dates: {} };

    // 平日プランをスクレイピング
    console.log('    → BASE: 平日プランをスクレイピング中...');
    await page.goto(BOOKING_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 4000));
    const weekdaySlots = await scrapePlan(page, '120分1名様(平日)');

    // 土日プランをスクレイピング
    console.log('    → BASE: 土日プランをスクレイピング中...');
    await page.goto(BOOKING_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 4000));
    const weekendSlots = await scrapePlan(page, '120分1名様(土曜・日曜・祭日)');

    // 結果を統合（平日は平日プラン、土日は土日プランのデータを使用）
    const allDates = new Set([...Object.keys(weekdaySlots), ...Object.keys(weekendSlots)]);

    for (const dateStr of allDates) {
      const slots = isWeekdayDate(dateStr) ? weekdaySlots[dateStr] : weekendSlots[dateStr];
      if (slots && slots.length > 0) {
        // 時間をソート
        const sortedTimes = slots.sort((a, b) => {
          const aParts = a.split(':');
          const bParts = b.split(':');
          return (parseInt(aParts[0]) * 60 + parseInt(aParts[1])) - (parseInt(bParts[0]) * 60 + parseInt(bParts[1]));
        });

        // 00分のスロットのみ
        const simplifiedSlots = sortedTimes.filter(t => t.indexOf(':00') !== -1);

        result.dates[dateStr] = {};
        for (const course of COURSE_NAMES) {
          result.dates[dateStr][course] = simplifiedSlots;
        }
      }
    }

    console.log(`    → BASE: 平日${Object.keys(weekdaySlots).length}日, 土日${Object.keys(weekendSlots).length}日 取得`);

    return result;
  } finally {
    await page.close();
  }
}

module.exports = { scrape };
