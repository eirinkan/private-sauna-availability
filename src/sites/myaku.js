/**
 * 脈 -MYAKU PRIVATE SAUNA- (spot-ly) スクレイパー
 * 予約ページ: https://spot-ly.jp/ja/hotels/176
 *
 * 方式: 予約ページが内部で使う空き状況API（JSON）を直接呼ぶ
 * - 旧方式（Puppeteer + FlareSolverrで人数選択→モーダル操作）は本番環境で
 *   react-select要素の描画待ちやspot-ly側の504エラーで間欠的に失敗していた。
 *   さらにプランのボタン順序をインデックス固定で想定していたため、サイトの
 *   プラン並び順が変わるとプラン名と時間帯の対応がズレる問題もあった。
 *   → 2026-07-07にAPI直接方式へ全面変更（ブラウザ・FlareSolverr不要）
 *
 * APIの構造（ホスト: api.spot-ly.jp）:
 * 1. 部屋・プラン一覧: /api/v2/spotly/hotels/176/room_types
 *    ?checkinDatetime=YYYY-MM-DD+00:00:00&checkoutDatetime=（翌日）&roomTypeCategory=
 *    ※ checkin < checkout でないと422エラー
 *    → data[].id（部屋ID）, data[].name（部屋名）, data[].capacity.maxNumberOfGuest,
 *      data[].plans[].id（プランID）, data[].plans[].name（プラン名）
 * 2. 空き時間帯: /api/v2/spotly/room_types/{部屋ID}/fixed_plans/{プランID}/available_times
 *    ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *    → [{startDateTime, endDateTime, isAvailable}]（時刻はUTC、JSTへ+9時間変換が必要）
 * - 認証・Cookie不要（User-AgentとAccept: application/jsonのみ）
 *
 * ナイトパックの扱い:
 * - APIのナイトパック枠はJST深夜開始（例: 7/8 00:30〜9:00 = 「7/7の夜」の枠）
 * - アプリ上は前日（=入店する夜の日付）に載せ、時間帯は「翌M/D H:MM〜H:MM」形式
 *   （ナイトパック統一形式: 翌日の日付を先頭に付与）
 */

const API_BASE = 'https://api.spot-ly.jp/api/v2/spotly';
const HOTEL_ID = 176;

// 部屋ごとの表示設定（価格はAPIから取れないため固定値）
// matcher: room_types APIの部屋名に含まれる文字列
const ROOM_CONFIG = [
  { matcher: 'KYU', displayRoom: '休 KYU', dayPrice: '¥9,130〜', nightPrice: '¥9,130〜' },
  { matcher: 'MIZU', displayRoom: '水 MIZU', dayPrice: '¥6,600〜', nightPrice: '¥8,800〜' },
  { matcher: 'HI', displayRoom: '火 HI', dayPrice: '¥7,150〜', nightPrice: '¥10,120〜' }
];

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ja'
};

// JSONを取得（エラー時はthrowしてヘルスチェックで検知できるようにする）
async function fetchJson(url) {
  const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new Error(`脈 API エラー: ${res.status} ${url}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    throw new Error(`脈 API が JSON 以外を返却: ${contentType} ${url}`);
  }
  return res.json();
}

// JST基準の今日からn日後の日付をYYYY-MM-DD形式で返す（Cloud RunはUTC動作のため手動変換）
function jstDateStr(daysFromToday) {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  jst.setUTCDate(jst.getUTCDate() + daysFromToday);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// UTC文字列をJSTの{dateStr, hour, minute}に変換
function toJst(utcStr) {
  const t = new Date(utcStr);
  const jst = new Date(t.getTime() + 9 * 60 * 60 * 1000);
  return {
    dateStr: `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`,
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
    time: `${jst.getUTCHours()}:${String(jst.getUTCMinutes()).padStart(2, '0')}`
  };
}

// プラン名から時間表記を抽出（【休 -KYU-】90分プラン → 90分、ナイトパック → night）
function planDuration(planName) {
  if (planName.includes('ナイトパック')) return 'night';
  const match = planName.match(/(\d+)分/);
  return match ? `${match[1]}分` : null;
}

// browser引数は他スクレイパーとのインターフェース統一のため受け取るが使用しない
async function scrape(browser) {
  const result = { dates: {} };

  // 部屋・プラン一覧を取得（checkin < checkout が必須）
  const checkin = jstDateStr(0);
  const checkout = jstDateStr(1);
  const roomTypesUrl = `${API_BASE}/hotels/${HOTEL_ID}/room_types?checkinDatetime=${checkin}+00%3A00%3A00&checkoutDatetime=${checkout}+00%3A00%3A00&roomTypeCategory=`;
  const roomTypes = await fetchJson(roomTypesUrl);
  const rooms = roomTypes.data || [];

  if (rooms.length === 0) {
    throw new Error('脈: 部屋一覧が空です（サイト構成変更の可能性）');
  }

  // 表示対象日: 今日〜6日後（ナイトパックの翌日枠も拾うため取得は+7日後まで）
  const startDate = jstDateStr(0);
  const endDate = jstDateStr(7);
  const displayDates = new Set([...Array(7)].map((_, i) => jstDateStr(i)));

  let matchedRooms = 0;

  for (const room of rooms) {
    const config = ROOM_CONFIG.find(c => room.name && room.name.includes(c.matcher));
    if (!config) {
      console.log(`    → 脈: 未知の部屋「${room.name}」をスキップ（表示設定なし）`);
      continue;
    }
    matchedRooms++;

    const capacity = room.capacity?.maxNumberOfGuest || '?';

    for (const plan of room.plans || []) {
      const duration = planDuration(plan.name);
      if (!duration) {
        console.log(`    → 脈: プラン「${plan.name}」の時間表記を解析できずスキップ`);
        continue;
      }

      const isNight = duration === 'night';
      const price = isNight ? config.nightPrice : config.dayPrice;
      const displayName = `${config.displayRoom}（${duration}/定員${capacity}名）${price}`;

      const times = await fetchJson(
        `${API_BASE}/room_types/${room.id}/fixed_plans/${plan.id}/available_times?startDate=${startDate}&endDate=${endDate}`
      );

      for (const frame of times) {
        if (!frame.isAvailable) continue;

        const start = toJst(frame.startDateTime);
        const end = toJst(frame.endDateTime);

        let dateStr;
        let timeStr;
        if (isNight) {
          // ナイトパック（JST深夜開始）は入店する夜＝前日に載せ、実際の日付を先頭に付与
          const prev = new Date(new Date(start.dateStr).getTime() - 24 * 60 * 60 * 1000);
          dateStr = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}-${String(prev.getUTCDate()).padStart(2, '0')}`;
          timeStr = `${start.month}/${start.day} ${start.time}〜${end.time}`;
        } else {
          dateStr = start.dateStr;
          timeStr = `${start.time}〜${end.time}`;
        }

        if (!displayDates.has(dateStr)) continue;

        if (!result.dates[dateStr]) result.dates[dateStr] = {};
        if (!result.dates[dateStr][displayName]) result.dates[dateStr][displayName] = [];
        if (!result.dates[dateStr][displayName].includes(timeStr)) {
          result.dates[dateStr][displayName].push(timeStr);
        }
      }
    }
  }

  if (matchedRooms === 0) {
    throw new Error('脈: 表示設定に一致する部屋がありません（部屋名変更の可能性）');
  }

  // 結果のログ出力
  const dateCount = Object.keys(result.dates).length;
  let totalSlots = 0;
  for (const dateData of Object.values(result.dates)) {
    for (const slots of Object.values(dateData)) {
      totalSlots += slots.length;
    }
  }
  console.log(`    → 脈: ${dateCount}日分のデータ取得, ${totalSlots}枠`);

  return result;
}

module.exports = { scrape };
