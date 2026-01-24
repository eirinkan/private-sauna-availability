#!/usr/bin/env node
/**
 * デイリーヘルスチェックスクリプト
 * GIRAFFE、サウナヨーガン、脈の3施設のスクレイピングが正常か監視
 *
 * 使用方法:
 *   node scripts/daily-check.js
 *
 * スケジュール:
 *   9時から1時間ごとに実行を試み、成功したらその日は実行しない
 *
 * チェック内容:
 *   - 7日分のデータを取得
 *   - 監視対象施設の空き枠が全日程で0件ならエラー（スクレイピング故障の可能性）
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const {
  isAlreadyExecutedToday,
  markAsExecuted,
  sendDesktopNotification
} = require('./desktop-notifier');

const PRODUCTION_URL = 'https://private-sauna-availability-526007709848.asia-northeast1.run.app';

// 監視対象の施設（スクレイピングが壊れやすい施設）
const WATCH_TARGETS = [
  { keyword: 'GIRAFFE 南天神', shortName: 'GIRAFFE南天神' },
  { keyword: 'GIRAFFE 天神', shortName: 'GIRAFFE天神' },
  { keyword: 'サウナヨーガン', shortName: 'ヨーガン' },
  { keyword: '脈', shortName: '脈' }
];

// チェックする日数
const CHECK_DAYS = 7;

/**
 * 指定日のAPIから空き状況を取得
 */
async function fetchAvailability(date) {
  const url = `${PRODUCTION_URL}/api/availability?date=${date}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return await response.json();
}

/**
 * 日付をYYYY-MM-DD形式で取得
 */
function getDateString(daysFromToday) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().split('T')[0];
}

/**
 * 監視対象施設を探す
 */
function findWatchedFacility(facilities, keyword) {
  return facilities.find(f => f.name.includes(keyword));
}

/**
 * ヘルスチェックを実行
 */
async function runHealthCheck() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  const timeStr = today.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  console.log(`\n========================================`);
  console.log(`スクレイピング監視チェック: ${timeStr}`);
  console.log(`監視対象: ${WATCH_TARGETS.map(t => t.shortName).join(', ')}`);
  console.log(`========================================\n`);

  // 既に今日実行済みかチェック
  if (isAlreadyExecutedToday()) {
    console.log('[スキップ] 今日は既に実行済みです');
    return { skipped: true };
  }

  // 各施設の7日分の空き枠数を集計
  const facilityStats = {};
  for (const target of WATCH_TARGETS) {
    facilityStats[target.keyword] = {
      shortName: target.shortName,
      totalSlots: 0,
      daysWithSlots: 0,
      found: false
    };
  }

  const errors = [];

  try {
    console.log(`[チェック] ${CHECK_DAYS}日分のデータを取得中...\n`);

    for (let i = 0; i < CHECK_DAYS; i++) {
      const checkDate = getDateString(i);
      process.stdout.write(`  ${checkDate}: `);

      try {
        const data = await fetchAvailability(checkDate);

        for (const target of WATCH_TARGETS) {
          const facility = findWatchedFacility(data.facilities, target.keyword);
          if (facility) {
            facilityStats[target.keyword].found = true;
            const slots = facility.rooms.reduce((sum, room) => sum + room.availableSlots.length, 0);
            facilityStats[target.keyword].totalSlots += slots;
            if (slots > 0) {
              facilityStats[target.keyword].daysWithSlots++;
            }
          }
        }

        console.log('OK');
      } catch (e) {
        console.log(`エラー (${e.message})`);
      }

      // API負荷軽減のため少し待機
      if (i < CHECK_DAYS - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log(`\n----------------------------------------`);
    console.log(`【結果】`);

    // 結果判定
    for (const target of WATCH_TARGETS) {
      const stats = facilityStats[target.keyword];
      const icon = stats.totalSlots > 0 ? '✓' : '✗';
      console.log(`[${icon}] ${stats.shortName}: ${stats.totalSlots}枠 (${stats.daysWithSlots}/${CHECK_DAYS}日に空きあり)`);

      // 施設が見つからない場合
      if (!stats.found) {
        errors.push(`${stats.shortName}: 施設データが見つからない`);
      }
      // 7日間すべて空き0件の場合はスクレイピング故障の可能性大
      else if (stats.totalSlots === 0) {
        errors.push(`${stats.shortName}: 7日間すべて空き0件（スクレイピング故障の可能性）`);
      }
    }

    console.log(`----------------------------------------\n`);

    // 成功したので実行済みマークを作成
    markAsExecuted();

  } catch (error) {
    errors.push(`API取得エラー: ${error.message}`);
    console.error(`[エラー] API取得失敗: ${error.message}`);

    // API取得エラーの場合は実行済みマークを作成しない（次の時間帯で再試行）
    console.log('[リトライ] API取得に失敗したため、次の時間帯で再試行します');

    await sendDesktopNotification(
      '❌ サウナ空き状況 - 接続エラー',
      `${error.message}\n次の時間帯で再試行します`,
      dateStr,
      'Basso'
    );

    return { hasError: true, errors };
  }

  // 通知送信
  if (errors.length > 0) {
    // エラーあり
    const message = errors.join('\n');
    await sendDesktopNotification(
      '⚠️ サウナ空き状況 - 異常検出',
      message,
      `${dateStr}`,
      'Basso'
    );
    console.log('[通知] エラー検出 - デスクトップ通知送信');
  } else {
    // 正常
    const summary = WATCH_TARGETS.map(t => {
      const stats = facilityStats[t.keyword];
      return `${stats.shortName}: ${stats.totalSlots}枠`;
    }).join(', ');

    await sendDesktopNotification(
      '✅ サウナ空き状況 - 正常',
      summary,
      `${dateStr}`,
      'Glass'
    );
    console.log('[通知] 正常 - デスクトップ通知送信');
  }

  return { hasError: errors.length > 0, errors };
}

// メイン実行
runHealthCheck()
  .then(results => {
    if (results.skipped) {
      console.log('今日の実行は完了済みのため、終了します');
      process.exit(0);
    }
    process.exit(results.hasError ? 1 : 0);
  })
  .catch(error => {
    console.error('予期しないエラー:', error);
    process.exit(1);
  });
