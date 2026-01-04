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

// コース種別（表示用）- 統一フォーマット：部屋名（時間/定員）価格
const COURSE_NAMES = ['BASE（120分/定員2名）¥6,500-10,800'];

// 今日が平日かどうか判定
function isWeekday(date) {
  const day = date.getDay();
  return day >= 1 && day <= 5; // 月〜金
}

// プラン利用時間（分）
const PLAN_DURATION = 120;

async function scrape(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 900 });

  try {
    await page.goto(BOOKING_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 4000));

    const result = { dates: {} };
    const today = new Date();

    // 今日が平日か土日かを判定して適切なプランを選択
    const targetPlan = isWeekday(today) ? '120分1名様(平日)' : '120分1名様(土曜・日曜・祭日)';

    // 1. メニュー選択ボタンをクリック
    // 「選択してください」テキストを含むボタンをPuppeteerネイティブでクリック
    let menuClicked = false;

    // ボタンを全て取得してテキストでフィルタリング
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text && text.includes('選択してください')) {
        await btn.click();
        menuClicked = true;
        console.log('    → BASE: メニューボタンをクリック');
        break;
      }
    }

    // 見つからなければ、page.evaluateでクリック
    if (!menuClicked) {
      menuClicked = await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          const text = btn.textContent.trim();
          if (text.includes('選択してください') || text.includes('変更')) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      if (menuClicked) {
        console.log('    → BASE: メニューボタンをevaluateでクリック');
      }
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    // ダイアログが開くのを待機
    try {
      await page.waitForSelector('dialog, [role="dialog"]', { timeout: 8000 });
      console.log('    → BASE: ダイアログが開きました');
    } catch (e) {
      console.log('    → BASE: ダイアログが開きません。再試行...');

      // 再度ボタンを探してクリック
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

    // 2. コース選択（今日の曜日に応じたプラン）
    const courseSelected = await page.evaluate((plan) => {
      // ラジオボタンを直接探す
      const radios = document.querySelectorAll('input[type="radio"]');
      for (const radio of radios) {
        const label = radio.closest('label');
        if (label && label.textContent.includes(plan)) {
          radio.click();
          return 'radio clicked: ' + plan;
        }
      }

      // ラベルを探す
      const labels = document.querySelectorAll('label');
      for (const label of labels) {
        if (label.textContent.includes(plan)) {
          const input = label.querySelector('input');
          if (input) {
            input.click();
            return 'input clicked: ' + plan;
          }
          label.click();
          return 'label clicked: ' + plan;
        }
      }
      return 'not found: ' + plan;
    }, targetPlan);
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

    // 4. カレンダーが読み込まれるまで待機
    // input[name="dateTimeSelection"] はカレンダーの予約枠ラジオボタン
    try {
      await page.waitForSelector('input[name="dateTimeSelection"]', { timeout: 15000 });
      console.log('    → BASE: カレンダー要素を検出');
    } catch (e) {
      console.log('    → BASE: カレンダー要素タイムアウト、ダイアログ確認...');

      // ダイアログがまだ開いているか確認
      const dialogOpen = await page.evaluate(() => {
        return !!document.querySelector('dialog[open], [role="dialog"]');
      });

      if (dialogOpen) {
        console.log('    → BASE: ダイアログがまだ開いています。完了ボタンを再クリック...');
        await page.evaluate(() => {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            const text = btn.textContent.trim();
            if (text === '完了' || text === '決定' || text.includes('OK')) {
              btn.click();
              return;
            }
          }
        });
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        // ダイアログが閉じているなら、ページをスクロールして待機
        await page.evaluate(() => window.scrollBy(0, 300));
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // 再度カレンダー要素を待機
      try {
        await page.waitForSelector('input[name="dateTimeSelection"]', { timeout: 10000 });
        console.log('    → BASE: 再試行でカレンダー要素を検出');
      } catch (e2) {
        // デバッグ用: ページの状態を記録
        const pageState = await page.evaluate(() => {
          return {
            url: window.location.href,
            radioCount: document.querySelectorAll('input[type="radio"]').length,
            buttonTexts: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim().substring(0, 30)).slice(0, 10)
          };
        });
        console.log('    → BASE: ページ状態:', JSON.stringify(pageState));
      }
    }
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 5. ラジオボタンから空き枠を抽出（ISOタイムスタンプ形式）
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

        // 開始時間
        const startHour = jstHour;
        const startMin = parseInt(utcMin);

        // 終了時間（120分後）
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
