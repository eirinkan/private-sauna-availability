#!/usr/bin/env node
/**
 * デイリーヘルスチェックスクリプト
 * 本番APIから空き状況を取得し、結果をデスクトップ通知で表示
 *
 * 使用方法:
 *   node scripts/daily-check.js
 *
 * スケジュール:
 *   9時から1時間ごとに実行を試み、成功したらその日は実行しない
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const {
  notifyHealthCheckResult,
  isAlreadyExecutedToday,
  markAsExecuted,
  sendDesktopNotification
} = require('./desktop-notifier');

const PRODUCTION_URL = 'https://private-sauna-availability-526007709848.asia-northeast1.run.app';

/**
 * 本番APIから空き状況を取得
 */
async function fetchAvailability(date) {
  const url = `${PRODUCTION_URL}/api/availability?date=${date}`;
  console.log(`[API] ${url} を取得中...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return await response.json();
}

/**
 * ヘルスチェックを実行
 */
async function runHealthCheck() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  const timeStr = today.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  console.log(`\n========================================`);
  console.log(`デイリーヘルスチェック: ${timeStr}`);
  console.log(`========================================\n`);

  // 既に今日実行済みかチェック
  if (isAlreadyExecutedToday()) {
    console.log('[スキップ] 今日は既に実行済みです');
    return { skipped: true };
  }

  const results = {
    date: dateStr,
    timestamp: timeStr,
    facilities: [],
    hasError: false,
    hasWarning: false,
    errors: [],
    warnings: []
  };

  try {
    const data = await fetchAvailability(dateStr);

    // 各施設をチェック
    for (const facility of data.facilities) {
      const totalSlots = facility.rooms.reduce((sum, room) => sum + room.availableSlots.length, 0);
      const roomCount = facility.rooms.length;

      const facilityResult = {
        name: facility.name,
        totalSlots,
        roomCount,
        status: 'ok'
      };

      // エラー判定
      if (roomCount === 0) {
        facilityResult.status = 'error';
        results.hasError = true;
        results.errors.push(`${facility.name}: 部屋データが0件`);
      } else if (facility.error) {
        facilityResult.status = 'error';
        results.hasError = true;
        results.errors.push(`${facility.name}: ${facility.error}`);
      }

      // 警告判定（空き枠が極端に少ない）
      if (totalSlots === 0 && facilityResult.status !== 'error') {
        facilityResult.status = 'warning';
        results.hasWarning = true;
        results.warnings.push(`${facility.name}: 空き枠0件`);
      }

      results.facilities.push(facilityResult);

      // コンソール出力
      const statusIcon = facilityResult.status === 'ok' ? '✓' : facilityResult.status === 'warning' ? '!' : '✗';
      console.log(`[${statusIcon}] ${facility.name}: ${totalSlots}枠 (${roomCount}部屋)`);
    }

    console.log(`\n----------------------------------------`);
    console.log(`総施設数: ${results.facilities.length}`);
    console.log(`エラー: ${results.errors.length}件`);
    console.log(`警告: ${results.warnings.length}件`);
    console.log(`----------------------------------------\n`);

    // 成功したので実行済みマークを作成
    markAsExecuted();

  } catch (error) {
    results.hasError = true;
    results.errors.push(`API取得エラー: ${error.message}`);
    console.error(`[エラー] API取得失敗: ${error.message}`);

    // API取得エラーの場合は実行済みマークを作成しない（次の時間帯で再試行）
    console.log('[リトライ] API取得に失敗したため、次の時間帯で再試行します');

    // エラー通知は送信
    await sendDesktopNotification(
      '❌ サウナチェッカー - API接続エラー',
      `${error.message}\n次の時間帯で再試行します`,
      dateStr,
      'Basso'
    );

    return results;
  }

  // デスクトップ通知を送信
  await notifyHealthCheckResult(results);

  return results;
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
