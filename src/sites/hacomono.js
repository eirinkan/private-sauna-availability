/**
 * KUDOCHI福岡中洲 (hacomono) スクレイパー
 * URL: https://kudochi-sauna.hacomono.jp/reserve/schedule/6/25
 *
 * 構造:
 * - .dayクラスが14個（index 0-6: 日付ヘッダー、index 7-13: 実際のスケジュール）
 * - .d_lesson要素が各スロット（disabled クラスで予約不可を判定）
 * - .d_lesson .fs_2.mb_text: 時間（例: "15:30 - 17:00"）
 * - .d_lesson .schedule-label: 部屋名（例: "Silk - 90分"）
 */

// 福岡中洲店の予約スケジュールURL
const URL = 'https://kudochi-sauna.hacomono.jp/reserve/schedule/6/25';

// 部屋名と定員情報（統一フォーマット：部屋名（時間/定員）価格）
// 通常プラン
const ROOM_INFO = {
  'Silk': 'Silk（90分/120分/定員2名）¥6,000-8,000',
  'Orca': 'Orca（90分/120分/定員2名）¥6,000-8,000',
  'Gold': 'Gold（90分/120分/定員2名）¥8,000-10,000',
  'Club': 'Club（90分/120分/定員3名）¥8,000-10,000',
  'Grove': 'Grove（90分/120分/定員3名）¥8,000-10,000',
  'Oasis': 'Oasis（120分/定員4名）¥16,000',
  'Eden': 'Eden（120分/定員6名）¥24,000'
};

// ナイトパック（5時間）
const NIGHT_PACK_INFO = {
  'Silk': 'Silk（night/定員2名）¥12,000',
  'Orca': 'Orca（night/定員2名）¥12,000',
  'Gold': 'Gold（night/定員2名）¥15,000',
  'Club': 'Club（night/定員3名）¥18,000',
  'Grove': 'Grove（night/定員3名）¥18,000',
  'Oasis': 'Oasis（night/定員4名）¥20,000',
  'Eden': 'Eden（night/定員6名）¥28,000'
};

const ROOM_NAMES = Object.keys(ROOM_INFO);

async function scrape(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1400, height: 900 });

  try {
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
    // SPAなので長めに待機
    await new Promise(resolve => setTimeout(resolve, 8000));

    // ページから全日付のデータを一括取得（DOM要素ベースの解析）
    const allData = await page.evaluate((rooms) => {
      const dayElements = document.querySelectorAll('.day');
      const result = [];

      // .day要素は14個：index 0-6は日付ヘッダー、index 7-13がスケジュールデータ
      // 日付ヘッダー（index 0-6）から日付情報を取得
      const dateHeaders = [];
      for (let i = 0; i < 7 && i < dayElements.length; i++) {
        const headerText = dayElements[i].textContent.trim();
        // "1/3 (土) SilkOrca..." のようなテキストから日付部分を抽出
        const match = headerText.match(/^(\d{1,2})\/(\d{1,2})\s*\([日月火水木金土]\)/);
        if (match) {
          dateHeaders.push({
            month: parseInt(match[1]),
            day: parseInt(match[2])
          });
        }
      }

      // スケジュールデータ（index 7-13）を解析
      for (let i = 7; i < 14 && i < dayElements.length; i++) {
        const dayIndex = i - 7; // 0-6
        const dateInfo = dateHeaders[dayIndex];
        if (!dateInfo) continue;

        const dayEl = dayElements[i];
        const roomSlots = {};
        const nightSlots = {}; // ナイトパック用
        rooms.forEach(r => {
          roomSlots[r] = [];
          nightSlots[r] = [];
        });

        // 空きスロットのみ取得（disabled クラスがないもの）
        const availableLessons = dayEl.querySelectorAll('.d_lesson:not(.disabled)');

        availableLessons.forEach(lesson => {
          // FULLテキストがある場合は予約不可としてスキップ
          const lessonText = (lesson.textContent || '').toUpperCase();
          const lessonHtml = (lesson.innerHTML || '').toUpperCase();
          // テキスト内容とHTML内容の両方をチェック
          if (lessonText.includes('FULL') || lessonHtml.includes('FULL') ||
              lessonText.includes('満席') || lessonText.includes('×') ||
              lesson.classList.contains('full') || lesson.classList.contains('is-full')) {
            return;
          }

          // 時間を取得（.fs_2.mb_text 要素）
          const timeEl = lesson.querySelector('.fs_2.mb_text');
          // 部屋名を取得（.schedule-label 要素）
          const labelEl = lesson.querySelector('.schedule-label');

          if (timeEl && labelEl) {
            const timeText = timeEl.textContent.trim(); // "15:30 - 17:00"
            const labelText = labelEl.textContent.trim(); // "Silk - 90分" or "【5時間パック】Silk"

            // 時間をそのまま使用（開始〜終了形式）
            const timeParts = timeText.split(' - ');
            if (timeParts.length < 2) return;
            const timeRange = timeParts[0] + '〜' + timeParts[1]; // "15:30〜17:00"

            // ナイトパック判定
            const isNightPack = labelText.includes('5時間パック') || labelText.includes('ナイト');

            // 部屋名を抽出
            // パターン1: "Silk - 90分" → "Silk"
            // パターン2: "【5時間パック】Silk" → "Silk"
            let roomName = null;
            for (const room of rooms) {
              if (labelText.includes(room)) {
                roomName = room;
                break;
              }
            }

            if (roomName) {
              if (isNightPack) {
                if (!nightSlots[roomName].includes(timeRange)) {
                  nightSlots[roomName].push(timeRange);
                }
              } else {
                if (!roomSlots[roomName].includes(timeRange)) {
                  roomSlots[roomName].push(timeRange);
                }
              }
            }
          }
        });

        result.push({
          month: dateInfo.month,
          day: dateInfo.day,
          slots: roomSlots,
          nightSlots: nightSlots
        });
      }

      return result;
    }, ROOM_NAMES);

    // 結果を整形
    const result = { dates: {} };
    const now = new Date();
    const currentYear = now.getFullYear();

    for (const dayData of allData) {
      // 年を決定（1月で現在が12月なら来年）
      let year = currentYear;
      if (dayData.month === 1 && now.getMonth() === 11) {
        year = currentYear + 1;
      }

      const dateStr = `${year}-${String(dayData.month).padStart(2, '0')}-${String(dayData.day).padStart(2, '0')}`;
      result.dates[dateStr] = {};

      // 時間ソート関数
      const sortSlots = (slots) => {
        return slots.sort((a, b) => {
          const aStart = a.split('〜')[0];
          const bStart = b.split('〜')[0];
          const [aH, aM] = aStart.split(':').map(Number);
          const [bH, bM] = bStart.split(':').map(Number);
          // 深夜帯（0-6時）は24時以降として扱う
          const aHour = aH < 7 ? aH + 24 : aH;
          const bHour = bH < 7 ? bH + 24 : bH;
          return (aHour * 60 + aM) - (bHour * 60 + bM);
        });
      };

      for (const room of ROOM_NAMES) {
        // 通常プラン
        const slots = dayData.slots[room] || [];
        const displayName = ROOM_INFO[room] || room;
        result.dates[dateStr][displayName] = sortSlots(slots);

        // ナイトパック（空きがある場合のみ追加）
        const nightSlots = dayData.nightSlots[room] || [];
        if (nightSlots.length > 0 || slots.length === 0) {
          // ナイトパックは常に表示（通常プランと同様に）
          const nightDisplayName = NIGHT_PACK_INFO[room] || `${room}（night）`;
          result.dates[dateStr][nightDisplayName] = sortSlots(nightSlots);
        }
      }
    }

    return result;
  } finally {
    await page.close();
  }
}

module.exports = { scrape };
