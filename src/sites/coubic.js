/**
 * BASE Private sauna (Coubic) スクレイパー
 * URL: https://coubic.com/base-private-sauna/3957380/book
 *
 * 構造:
 * - メニュー選択 → コース選択 → 完了ボタンで日時選択画面が表示
 * - 空き枠はラジオボタンのvalue属性にISOタイムスタンプとして格納
 *   例: "2026-01-05T01:00:00.000Z" = 2026-01-05 10:00 JST
 * - ラジオボタンが存在する = 空きあり、存在しない = 空きなし
 */

const BOOKING_URL = 'https://coubic.com/base-private-sauna/3957380/book';

// コース種別（表示用）
const COURSE_NAMES = ['80分コース'];

async function scrape(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 900 });

  try {
    await page.goto(BOOKING_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 4000));

    const result = { dates: {} };

    // 1. メニュー選択ボタンをクリック（複数のセレクタを試す）
    let menuClicked = false;
    const menuSelectors = [
      '.CourseSelectModalWithIndicator_indicator-button__hzGVt',
      'button[type="button"]',
      '[class*="indicator-button"]'
    ];

    for (const selector of menuSelectors) {
      const btn = await page.$(selector);
      if (btn) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text && (text.includes('メニュー') || text.includes('選択'))) {
          await btn.click();
          menuClicked = true;
          break;
        }
      }
    }

    // ボタンが見つからない場合、テキストで探す
    if (!menuClicked) {
      await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          if (btn.textContent.includes('メニュー') || btn.textContent.includes('変更')) {
            btn.click();
            return true;
          }
        }
        return false;
      });
    }
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 2. コース選択（80分1名様(平日)）
    const courseSelected = await page.evaluate(() => {
      // まずラベルを探す
      const labels = document.querySelectorAll('label');
      for (const label of labels) {
        if (label.textContent.includes('80分1名様(平日)')) {
          const input = label.querySelector('input');
          if (input) {
            input.click();
            return 'input clicked';
          }
          label.click();
          return 'label clicked';
        }
      }
      // div要素も探す
      const divs = document.querySelectorAll('div[class*="cursor-pointer"], div[role="button"]');
      for (const div of divs) {
        if (div.textContent.includes('80分1名様(平日)')) {
          div.click();
          return 'div clicked';
        }
      }
      return 'not found';
    });
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. 完了ボタンをクリック
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent.trim();
        if (text === '完了' || text === '決定' || text === 'OK') {
          btn.click();
          return true;
        }
      }
      return false;
    });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 4. ラジオボタンから空き枠を抽出（ISOタイムスタンプ形式）
    // 注意: page.evaluate内では正規表現が正しく動作しないことがあるため文字列操作を使用
    const calendarData = await page.evaluate(() => {
      const availableSlots = {};
      let inputCount = 0;

      // 全てのinput要素を取得
      const inputs = document.querySelectorAll('input');
      inputs.forEach(function(input) {
        const value = input.value;
        if (!value || value.indexOf('T') === -1) return;

        // "2026-01-05T01:00:00.000Z" をパース（文字列操作）
        const datePart = value.split('T')[0];  // "2026-01-05"
        const timePart = value.split('T')[1];  // "01:00:00.000Z"

        if (!datePart || !timePart) return;

        const dateParts = datePart.split('-');
        const timeParts = timePart.split(':');

        if (dateParts.length < 3 || timeParts.length < 2) return;

        inputCount++;

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
          // 月末処理
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
        const timeStr = pad(jstHour) + ':' + utcMin;

        if (!availableSlots[dateStr]) {
          availableSlots[dateStr] = [];
        }
        if (availableSlots[dateStr].indexOf(timeStr) === -1) {
          availableSlots[dateStr].push(timeStr);
        }
      });

      return { slots: availableSlots, inputCount: inputCount, totalInputs: inputs.length };
    });

    // デバッグログ
    console.log(`    → BASE: ${calendarData.totalInputs} inputs, ${calendarData.inputCount} ISO timestamps found`);

    // 結果を構築
    const slots = calendarData.slots || {};
    for (const [dateStr, times] of Object.entries(slots)) {
      result.dates[dateStr] = {};

      // 時間をソート
      const sortedTimes = times.sort((a, b) => {
        const aParts = a.split(':');
        const bParts = b.split(':');
        const aH = parseInt(aParts[0]);
        const aM = parseInt(aParts[1]);
        const bH = parseInt(bParts[0]);
        const bM = parseInt(bParts[1]);
        return (aH * 60 + aM) - (bH * 60 + bM);
      });

      // 00分のスロットのみ表示（10分刻みを簡略化）
      const simplifiedSlots = sortedTimes.filter(t => t.indexOf(':00') !== -1);

      for (const course of COURSE_NAMES) {
        result.dates[dateStr][course] = simplifiedSlots;
      }
    }

    return result;
  } finally {
    await page.close();
  }
}

module.exports = { scrape };
