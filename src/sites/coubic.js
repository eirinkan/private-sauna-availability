/**
 * BASE Private sauna (STORES予約 / 旧Coubic) スクレイパー
 * 予約ページ: https://fukuoka-yakuin.stores.jp/reserve/base-private-sauna/3957380/book
 * （旧URL https://coubic.com/base-private-sauna/3957380/book はリダイレクトされる）
 *
 * 方式: 予約ページが内部で使う空き状況API（JSON）を直接呼ぶ
 * - 旧方式（Puppeteerでボタンクリック→画面遷移）は本番環境で読み込みタイミングにより
 *   間欠的に失敗していたため、2026-07-07にAPI直接方式へ全面変更
 * - ブラウザ不要・認証不要（User-AgentとAccept: application/jsonのみ必要）
 *
 * APIの構造:
 * 1. コース一覧: /courses → nameで検索し canonical_id を得る
 *    ※ board_datesで使うIDは「id」ではなく「canonical_id」（idを使うと404）
 * 2. 空き状況: /courses/{canonical_id}/availability/board_dates
 *    → selected_date省略で今日から7日分（JST）を返す
 *    → dates[].availabilities[] の is_available で空き判定
 * - 平日プランは土日祝で全枠false、土日プランは平日で全枠falseになるため、
 *   両プランの結果を単純に統合すれば祝日判定はAPI側に任せられる
 */

const API_BASE = 'https://fukuoka-yakuin.stores.jp/reserve/api/reservation_flow/merchants/base-private-sauna/course_scheme/resources/3957380';

// 取得対象プラン（コース一覧のnameと完全一致）
const TARGET_PLANS = ['120分1名様(平日)', '120分1名様(土曜・日曜・祭日)'];

// コース種別（表示用）- 統一フォーマット：部屋名（時間/定員）価格
const COURSE_NAMES = ['BASE（120分/定員2名）¥6,500-10,800'];

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ja'
};

// JSONを取得（エラー時はthrowしてヘルスチェックで検知できるようにする）
async function fetchJson(url) {
  const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new Error(`BASE API エラー: ${res.status} ${url}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    // Cloudflareチャレンジ等でHTMLが返ってきた場合を検知
    throw new Error(`BASE API が JSON 以外を返却: ${contentType} ${url}`);
  }
  return res.json();
}

/**
 * 時間枠を整形する
 * - 同じ時間帯（XX:00〜XX:50）が全て空いていれば「XX時代全て」
 * - 一部のみ空いていれば個別に「XX:10〜、XX:20〜」
 */
function formatTimeSlots(slots) {
  // 時間帯ごとにグループ化（XX時台）
  const hourGroups = {};

  for (const slot of slots) {
    // "HH:MM〜" 形式から時間と分を抽出
    const match = slot.match(/^(\d{2}):(\d{2})〜$/);
    if (!match) continue;

    const hour = parseInt(match[1]);
    const minute = parseInt(match[2]);

    if (!hourGroups[hour]) {
      hourGroups[hour] = [];
    }
    hourGroups[hour].push(minute);
  }

  const result = [];
  const hours = Object.keys(hourGroups).map(Number).sort((a, b) => a - b);

  for (const hour of hours) {
    const minutes = hourGroups[hour].sort((a, b) => a - b);

    // 20時代は最終受付が20:30なので、4枠(00,10,20,30)が揃っていれば「20時代全て」
    // それ以外は6枠(00,10,20,30,40,50)が揃っている必要がある
    const allMinutes = hour === 20 ? [0, 10, 20, 30] : [0, 10, 20, 30, 40, 50];
    const hasAll = allMinutes.every(m => minutes.includes(m));

    if (hasAll) {
      // 全枠空き → 「XX時代全て」
      result.push(`${hour}時代全て`);
    } else {
      // 一部のみ → 個別表示「XX:MM〜」
      for (const minute of minutes) {
        const pad = (n) => n < 10 ? '0' + n : '' + n;
        result.push(`${pad(hour)}:${pad(minute)}〜`);
      }
    }
  }

  return result;
}

// 1プランの空き状況をAPIから取得 → { 'YYYY-MM-DD': ['HH:MM〜', ...] }
async function fetchPlanAvailability(canonicalId) {
  const data = await fetchJson(`${API_BASE}/courses/${canonicalId}/availability/board_dates`);
  const slots = {};

  for (const day of data.dates || []) {
    // time_unit_start_at は "2026-07-07T10:00:00.000+09:00" 形式（JST付き）
    const dateStr = day.time_unit_start_at.slice(0, 10);

    for (const a of day.availabilities || []) {
      if (!a.is_available) continue;
      // start_at の "THH:MM" 部分をそのまま使う（JSTオフセット付きなので変換不要）
      const timeStr = a.start_at.slice(11, 16) + '〜';

      if (!slots[dateStr]) slots[dateStr] = [];
      if (!slots[dateStr].includes(timeStr)) slots[dateStr].push(timeStr);
    }
  }

  return slots;
}

// browser引数は他スクレイパーとのインターフェース統一のため受け取るが使用しない
async function scrape(browser) {
  const result = { dates: {} };

  // コース一覧からプラン名 → canonical_id を解決
  const coursesData = await fetchJson(`${API_BASE}/courses`);
  const courses = coursesData.courses || [];

  const planIds = {};
  for (const planName of TARGET_PLANS) {
    const course = courses.find(c => c.name === planName);
    if (!course) {
      // プラン名変更を検知したら黙って空を返さずエラーにする
      throw new Error(`BASE: プラン「${planName}」がコース一覧に見つかりません`);
    }
    planIds[planName] = course.canonical_id;
  }

  // 各プランの空き状況を取得して統合
  // （平日プランは土日祝が全枠埋まり扱い、土日プランは平日が全枠埋まり扱いなので単純統合でよい）
  const merged = {};
  for (const planName of TARGET_PLANS) {
    console.log(`    → BASE: ${planName} をAPI取得中...`);
    const planSlots = await fetchPlanAvailability(planIds[planName]);
    for (const [dateStr, times] of Object.entries(planSlots)) {
      if (!merged[dateStr]) merged[dateStr] = [];
      for (const t of times) {
        if (!merged[dateStr].includes(t)) merged[dateStr].push(t);
      }
    }
  }

  for (const [dateStr, times] of Object.entries(merged)) {
    if (times.length === 0) continue;

    // 時間をソート
    const sortedTimes = times.sort((a, b) => {
      const aParts = a.split(':');
      const bParts = b.split(':');
      return (parseInt(aParts[0]) * 60 + parseInt(aParts[1])) - (parseInt(bParts[0]) * 60 + parseInt(bParts[1]));
    });

    // 時間帯をグループ化して表示形式を整える
    const formattedSlots = formatTimeSlots(sortedTimes);

    result.dates[dateStr] = {};
    for (const course of COURSE_NAMES) {
      result.dates[dateStr][course] = formattedSlots;
    }
  }

  console.log(`    → BASE: ${Object.keys(result.dates).length}日分 取得`);

  return result;
}

module.exports = { scrape };
