/**
 * 日本の祝日判定モジュール
 * 法律に基づいて計算するため、外部API・手動更新不要
 */

/**
 * 春分の日を計算（近似式）
 * 1900〜2099年で有効
 */
function getVernalEquinoxDay(year) {
  if (year >= 1900 && year <= 1979) {
    return Math.floor(20.8357 + 0.242194 * (year - 1980) - Math.floor((year - 1983) / 4));
  } else if (year >= 1980 && year <= 2099) {
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  // 範囲外はデフォルト
  return 20;
}

/**
 * 秋分の日を計算（近似式）
 * 1900〜2099年で有効
 */
function getAutumnalEquinoxDay(year) {
  if (year >= 1900 && year <= 1979) {
    return Math.floor(23.2588 + 0.242194 * (year - 1980) - Math.floor((year - 1983) / 4));
  } else if (year >= 1980 && year <= 2099) {
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  return 23;
}

/**
 * N月の第M月曜日の日付を返す
 */
function getNthMonday(year, month, nth) {
  const firstDay = new Date(year, month - 1, 1);
  let dayOfWeek = firstDay.getDay(); // 0=日, 1=月, ..., 6=土
  // 最初の月曜日
  let firstMonday = dayOfWeek <= 1 ? 1 + (1 - dayOfWeek) : 1 + (8 - dayOfWeek);
  return firstMonday + 7 * (nth - 1);
}

/**
 * 指定年の祝日一覧を取得（月/日の配列）
 * 振替休日・国民の休日も含む
 */
function getHolidays(year) {
  const holidays = new Map(); // key: 'MM-DD', value: 祝日名

  // 固定祝日
  holidays.set(`01-01`, '元日');
  holidays.set(`02-11`, '建国記念の日');
  holidays.set(`02-23`, '天皇誕生日');
  holidays.set(`04-29`, '昭和の日');
  holidays.set(`05-03`, '憲法記念日');
  holidays.set(`05-04`, 'みどりの日');
  holidays.set(`05-05`, 'こどもの日');
  holidays.set(`08-11`, '山の日');
  holidays.set(`11-03`, '文化の日');
  holidays.set(`11-23`, '勤労感謝の日');

  // ハッピーマンデー（第N月曜日）
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  const seijinDay = getNthMonday(year, 1, 2);
  holidays.set(`01-${pad(seijinDay)}`, '成人の日');

  const umiDay = getNthMonday(year, 7, 3);
  holidays.set(`07-${pad(umiDay)}`, '海の日');

  const keirouDay = getNthMonday(year, 9, 3);
  holidays.set(`09-${pad(keirouDay)}`, '敬老の日');

  const sportsDay = getNthMonday(year, 10, 2);
  holidays.set(`10-${pad(sportsDay)}`, 'スポーツの日');

  // 春分の日・秋分の日
  const vernalDay = getVernalEquinoxDay(year);
  holidays.set(`03-${pad(vernalDay)}`, '春分の日');

  const autumnalDay = getAutumnalEquinoxDay(year);
  holidays.set(`09-${pad(autumnalDay)}`, '秋分の日');

  // 振替休日: 祝日が日曜なら翌月曜が振替休日
  // （既に月曜が祝日なら火曜に繰り越し）
  const holidayDates = [];
  for (const [mmdd] of holidays) {
    const date = new Date(year, parseInt(mmdd.split('-')[0]) - 1, parseInt(mmdd.split('-')[1]));
    holidayDates.push({ mmdd, date });
  }

  for (const { mmdd, date } of holidayDates) {
    if (date.getDay() === 0) { // 日曜日
      // 翌日以降で祝日でない日を振替休日にする
      let substituteDate = new Date(date);
      do {
        substituteDate.setDate(substituteDate.getDate() + 1);
        const subMmdd = `${pad(substituteDate.getMonth() + 1)}-${pad(substituteDate.getDate())}`;
        if (!holidays.has(subMmdd)) {
          holidays.set(subMmdd, '振替休日');
          break;
        }
      } while (true);
    }
  }

  // 国民の休日: 祝日に挟まれた平日は休み
  // （前日と翌日が両方祝日で、その日自体が祝日でない場合）
  const allHolidayKeys = new Set(holidays.keys());
  for (const [mmdd] of [...holidays]) {
    const date = new Date(year, parseInt(mmdd.split('-')[0]) - 1, parseInt(mmdd.split('-')[1]));
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 2);
    const nextNextMmdd = `${pad(nextDate.getMonth() + 1)}-${pad(nextDate.getDate())}`;
    const betweenDate = new Date(date);
    betweenDate.setDate(betweenDate.getDate() + 1);
    const betweenMmdd = `${pad(betweenDate.getMonth() + 1)}-${pad(betweenDate.getDate())}`;

    if (allHolidayKeys.has(nextNextMmdd) && !allHolidayKeys.has(betweenMmdd)) {
      if (betweenDate.getDay() !== 0) { // 日曜でない場合のみ
        holidays.set(betweenMmdd, '国民の休日');
      }
    }
  }

  return holidays;
}

// 年ごとのキャッシュ
const holidayCache = {};

/**
 * 指定日が祝日かどうか判定
 * @param {string} dateStr - 'YYYY-MM-DD' 形式
 * @returns {boolean}
 */
function isHoliday(dateStr) {
  const parts = dateStr.split('-');
  const year = parseInt(parts[0]);
  const mmdd = `${parts[1]}-${parts[2]}`;

  if (!holidayCache[year]) {
    holidayCache[year] = getHolidays(year);
  }

  return holidayCache[year].has(mmdd);
}

module.exports = { isHoliday, getHolidays };
