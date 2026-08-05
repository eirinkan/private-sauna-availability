/**
 * テンジンサウナ (select-type) スクレイパー
 * URL: https://select-type.com/rsv/?id=1nwOWa5ac9Y
 *
 * 予約フローが3段階に分かれており、順にクリックしないとカレンダーが出ない:
 *   1. 「お部屋の種類」を選ぶ  → rsv.chgCrsCal(c_id) でフォーム送信
 *   2. 「ご利用時間」を選ぶ    → rsv.chgTimeMenu(tm_id, 'rom_area') でフォーム送信
 *   3. 週カレンダーが表示される（今日から7日分）
 *
 * カレンダーの構造:
 *   - 空き枠: <a onclick="rsv.loadRsvTimeModal(【UNIX秒】,...)">●</a>
 *   - 満席枠: リンクなしの「×」（UNIX秒を持たない）
 *   → 空き枠だけがUNIX秒を持つので、●のリンクからUNIX秒を集めてJSTに直す
 *
 * Cloudflare保護はないためFlareSolverr不要。
 */

const TOP_URL = 'https://select-type.com/rsv/?id=1nwOWa5ac9Y';

// 部屋（コース）情報
// c_id: 「お部屋の種類」のID / tm60: 60分プランのID / 定員・料金は公式サイト記載
// 60分プランで取得する理由: 刻みが最も細かく、空いている時間帯を一番正確に表せるため
// （90〜180分も同じ画面で選べるので、長時間利用は予約ページ側で選んでもらう）
const ROOMS = [
  {
    cId: 309512,
    tm60: 136991,
    name: 'StandardRoom（60分/定員2名）¥2,090'
  },
  {
    cId: 309513,
    tm60: 136988,
    name: 'DeluxeRoom（60分/定員4名）¥3,410'
  }
];

const SLOT_MINUTES = 60;

/**
 * UNIX秒をJSTの日付・時刻に変換する
 * Cloud RunはUTCで動くため、ローカルタイムに頼らず+9時間して組み立てる
 */
function toJst(unixSec) {
  const jst = new Date((unixSec + 9 * 3600) * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return {
    date: `${y}-${m}-${d}`,
    hour: jst.getUTCHours(),
    minute: jst.getUTCMinutes()
  };
}

/**
 * 開始UNIX秒から「HH:MM〜HH:MM」形式の時間帯文字列を作る
 */
function formatSlot(unixSec) {
  const start = toJst(unixSec);
  const end = toJst(unixSec + SLOT_MINUTES * 60);
  const hhmm = (t) => `${t.hour}:${String(t.minute).padStart(2, '0')}`;
  return { date: start.date, range: `${hhmm(start)}〜${hhmm(end)}` };
}

/**
 * 指定したクリック処理を実行し、フォーム送信による画面遷移を待つ
 */
async function clickAndWait(page, fn, arg) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
    page.evaluate(fn, arg)
  ]);
  // 遷移後の描画待ち
  await new Promise(resolve => setTimeout(resolve, 3000));
}

/**
 * 1部屋分の空き枠を取得する
 */
async function scrapeRoom(page, room) {
  await page.goto(TOP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(resolve => setTimeout(resolve, 2500));

  // 1. お部屋の種類を選ぶ
  await clickAndWait(page, (cId) => {
    const el = document.querySelector('#c_id' + cId);
    if (!el) throw new Error('部屋の選択肢が見つかりません: ' + cId);
    el.click();
  }, room.cId);

  // 2. ご利用時間（60分）を選ぶ
  await clickAndWait(page, (tmId) => {
    const el = document.querySelector('[onclick*="chgTimeMenu(' + tmId + '"]');
    if (!el) throw new Error('利用時間の選択肢が見つかりません: ' + tmId);
    el.click();
  }, room.tm60);

  // 3. 週カレンダーから空き枠（●のリンク）のUNIX秒を集める
  const timestamps = await page.evaluate(() => {
    const list = [];
    document.querySelectorAll('a[onclick*="loadRsvTimeModal"]').forEach(a => {
      const m = a.getAttribute('onclick').match(/loadRsvTimeModal\((\d+),/);
      // ●が空き。×はそもそもリンクを持たないが、念のためテキストでも確認する
      if (m && a.textContent.includes('●')) list.push(Number(m[1]));
    });
    return list;
  });

  if (timestamps.length === 0) {
    // カレンダー自体が出ていないのか、本当に満席なのかを切り分ける
    const hasCalendar = await page.evaluate(() =>
      document.querySelectorAll('a[onclick*="loadRsvTimeModal"], td.cl-day').length > 0
    );
    if (!hasCalendar) {
      throw new Error('カレンダーが表示されませんでした（画面構成が変わった可能性）');
    }
  }

  return timestamps;
}

async function scrape(browser) {
  const page = await browser.newPage();

  try {
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1400, height: 1200 });
    await page.emulateTimezone('Asia/Tokyo');

    const result = { dates: {} };

    for (const room of ROOMS) {
      try {
        const timestamps = await scrapeRoom(page, room);

        for (const ts of timestamps) {
          const { date, range } = formatSlot(ts);
          if (!result.dates[date]) result.dates[date] = {};
          if (!result.dates[date][room.name]) result.dates[date][room.name] = [];
          result.dates[date][room.name].push(range);
        }

        console.log(`    テンジンサウナ ${room.name.split('（')[0]}: ${timestamps.length}枠`);
      } catch (error) {
        console.error(`    テンジンサウナ ${room.name.split('（')[0]} エラー:`, error.message);
      }
    }

    // 時間順に並べる（"9:00〜10:00" のような1桁時間も正しく並ぶよう数値で比較）
    const toMinutes = (s) => {
      const [h, m] = s.split('〜')[0].split(':').map(Number);
      return h * 60 + m;
    };
    for (const date of Object.keys(result.dates)) {
      for (const roomName of Object.keys(result.dates[date])) {
        result.dates[date][roomName].sort((a, b) => toMinutes(a) - toMinutes(b));
      }
    }

    return result;
  } finally {
    await page.close();
  }
}

module.exports = { scrape };
