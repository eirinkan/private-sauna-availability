/**
 * スクレイピング故障検知・ログ機能
 * 連続失敗やデータ0件を検知し、通知トリガーを発行
 */

const fs = require('fs');
const path = require('path');

// ログファイルのパス
const LOG_DIR = path.join(__dirname, '..', 'logs');
const HEALTH_LOG_FILE = path.join(LOG_DIR, 'health-status.json');

// 設定
const CONFIG = {
  // 連続失敗でアラートを発行する回数
  consecutiveFailuresThreshold: 3,
  // ログ保持日数
  logRetentionDays: 30
};

/**
 * ヘルスステータスの構造
 * {
 *   sites: {
 *     "giraffe": {
 *       lastSuccess: "2024-01-06T10:00:00Z",
 *       lastFailure: null,
 *       consecutiveFailures: 0,
 *       history: [
 *         { timestamp: "...", status: "success", method: "dom", slots: 4 },
 *         { timestamp: "...", status: "failure", method: "dom", error: "..." }
 *       ]
 *     }
 *   }
 * }
 */

/**
 * ログディレクトリを初期化
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * 現在のヘルスステータスを読み込む
 * @returns {Object} ヘルスステータス
 */
function loadHealthStatus() {
  ensureLogDir();

  if (fs.existsSync(HEALTH_LOG_FILE)) {
    try {
      const data = fs.readFileSync(HEALTH_LOG_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('ヘルスログ読み込みエラー:', error.message);
      return { sites: {} };
    }
  }

  return { sites: {} };
}

/**
 * ヘルスステータスを保存
 * @param {Object} status - ヘルスステータス
 */
function saveHealthStatus(status) {
  ensureLogDir();

  try {
    fs.writeFileSync(HEALTH_LOG_FILE, JSON.stringify(status, null, 2), 'utf-8');
  } catch (error) {
    console.error('ヘルスログ保存エラー:', error.message);
  }
}

/**
 * 古いログエントリを削除
 * @param {Array} history - 履歴配列
 * @returns {Array} クリーンアップ後の履歴
 */
function cleanupOldLogs(history) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - CONFIG.logRetentionDays);

  return history.filter(entry => new Date(entry.timestamp) > cutoffDate);
}

/**
 * スクレイピング結果を記録
 * @param {string} siteName - サイト名
 * @param {Object} result - 結果 { success: boolean, method: string, slots?: number, error?: string }
 * @returns {Object} 通知が必要かどうかの判定結果
 */
function recordResult(siteName, result) {
  const status = loadHealthStatus();
  const timestamp = new Date().toISOString();

  // サイトのエントリを初期化
  if (!status.sites[siteName]) {
    status.sites[siteName] = {
      lastSuccess: null,
      lastFailure: null,
      consecutiveFailures: 0,
      lastMethod: null,
      history: []
    };
  }

  const site = status.sites[siteName];

  // 履歴エントリを作成
  const historyEntry = {
    timestamp,
    status: result.success ? 'success' : 'failure',
    method: result.method || 'unknown'
  };

  if (result.success) {
    historyEntry.slots = result.slots || 0;
  } else {
    historyEntry.error = result.error || '不明なエラー';
  }

  // ステータス更新
  if (result.success) {
    site.lastSuccess = timestamp;
    site.consecutiveFailures = 0;
    site.lastMethod = result.method;
  } else {
    site.lastFailure = timestamp;
    site.consecutiveFailures++;
    site.lastMethod = result.method;
  }

  // 履歴に追加（古いものを削除）
  site.history.push(historyEntry);
  site.history = cleanupOldLogs(site.history);

  // 保存
  saveHealthStatus(status);

  // 通知判定
  const notification = {
    shouldNotify: false,
    type: null,
    message: null
  };

  // 連続失敗アラート
  if (site.consecutiveFailures >= CONFIG.consecutiveFailuresThreshold) {
    notification.shouldNotify = true;
    notification.type = 'consecutive_failures';
    notification.message = `${siteName}: ${site.consecutiveFailures}回連続でスクレイピングに失敗しています`;
    notification.details = {
      siteName,
      consecutiveFailures: site.consecutiveFailures,
      lastMethod: site.lastMethod,
      lastError: result.error
    };
  }

  // AI Visionフォールバック発動通知
  if (result.success && result.method === 'ai-vision' && result.fallback) {
    notification.shouldNotify = true;
    notification.type = 'ai_fallback';
    notification.message = `${siteName}: DOM解析失敗、AI Visionにフォールバックしました`;
    notification.details = {
      siteName,
      originalMethod: 'dom',
      fallbackMethod: 'ai-vision',
      slots: result.slots
    };
  }

  return notification;
}

/**
 * サイトのヘルス状態を取得
 * @param {string} siteName - サイト名
 * @returns {Object} ヘルス状態
 */
function getSiteHealth(siteName) {
  const status = loadHealthStatus();
  return status.sites[siteName] || null;
}

/**
 * 全サイトのヘルスサマリーを取得
 * @returns {Object} ヘルスサマリー
 */
function getHealthSummary() {
  const status = loadHealthStatus();
  const summary = {
    totalSites: Object.keys(status.sites).length,
    healthySites: 0,
    unhealthySites: [],
    lastUpdated: new Date().toISOString()
  };

  for (const [siteName, site] of Object.entries(status.sites)) {
    if (site.consecutiveFailures >= CONFIG.consecutiveFailuresThreshold) {
      summary.unhealthySites.push({
        name: siteName,
        consecutiveFailures: site.consecutiveFailures,
        lastFailure: site.lastFailure
      });
    } else {
      summary.healthySites++;
    }
  }

  return summary;
}

/**
 * DOM解析失敗を記録（AI Visionフォールバック前）
 * @param {string} siteName - サイト名
 * @param {string} error - エラーメッセージ
 */
function recordDomFailure(siteName, error) {
  const status = loadHealthStatus();
  const timestamp = new Date().toISOString();

  if (!status.sites[siteName]) {
    status.sites[siteName] = {
      lastSuccess: null,
      lastFailure: null,
      consecutiveFailures: 0,
      lastMethod: null,
      history: [],
      domFailures: []
    };
  }

  if (!status.sites[siteName].domFailures) {
    status.sites[siteName].domFailures = [];
  }

  // DOM失敗を記録（自己修復分析用）
  status.sites[siteName].domFailures.push({
    timestamp,
    error
  });

  // 直近10件のみ保持
  if (status.sites[siteName].domFailures.length > 10) {
    status.sites[siteName].domFailures = status.sites[siteName].domFailures.slice(-10);
  }

  saveHealthStatus(status);
}

/**
 * ヘルスステータスをリセット（テスト用）
 * @param {string} siteName - サイト名（指定しない場合は全サイト）
 */
function resetHealthStatus(siteName = null) {
  if (siteName) {
    const status = loadHealthStatus();
    delete status.sites[siteName];
    saveHealthStatus(status);
  } else {
    saveHealthStatus({ sites: {} });
  }
}

module.exports = {
  recordResult,
  recordDomFailure,
  getSiteHealth,
  getHealthSummary,
  resetHealthStatus,
  CONFIG
};
