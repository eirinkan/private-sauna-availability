/**
 * 通知機能
 * スクレイピング故障時にメール通知を送信
 */

const nodemailer = require('nodemailer');

// 設定（環境変数から読み込み）
function getConfig() {
  return {
    enabled: process.env.NOTIFICATION_ENABLED === 'true',
    email: {
      to: process.env.NOTIFICATION_EMAIL,
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  };
}

// メールトランスポーター（遅延初期化）
let transporter = null;

/**
 * メールトランスポーターを取得
 * @returns {Object} nodemailer transporter
 */
function getTransporter() {
  const config = getConfig();

  if (!transporter && config.email.user && config.email.pass) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: {
        user: config.email.user,
        pass: config.email.pass
      }
    });
  }

  return transporter;
}

/**
 * メール通知を送信
 * @param {Object} notification - 通知内容
 * @returns {Promise<boolean>} 送信成功かどうか
 */
async function sendEmailNotification(notification) {
  const config = getConfig();

  if (!config.enabled) {
    console.log('[通知] 通知が無効化されています');
    return false;
  }

  if (!config.email.to) {
    console.error('[通知] 通知先メールアドレスが設定されていません');
    return false;
  }

  const transport = getTransporter();
  if (!transport) {
    console.error('[通知] SMTPの認証情報が設定されていません');
    return false;
  }

  // メール件名の決定
  let subject = '【サウナ空き状況チェッカー】';
  switch (notification.type) {
    case 'consecutive_failures':
      subject += '⚠️ スクレイピング連続失敗アラート';
      break;
    case 'ai_fallback':
      subject += '📢 AI Visionフォールバック発動';
      break;
    case 'recovery':
      subject += '✅ スクレイピング復旧通知';
      break;
    default:
      subject += '通知';
  }

  // メール本文の作成
  let body = `${notification.message}\n\n`;

  if (notification.details) {
    body += '【詳細】\n';
    for (const [key, value] of Object.entries(notification.details)) {
      body += `・${key}: ${value}\n`;
    }
  }

  body += `\n送信日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`;

  try {
    await transport.sendMail({
      from: config.email.user,
      to: config.email.to,
      subject,
      text: body
    });

    console.log(`[通知] メール送信成功: ${subject}`);
    return true;
  } catch (error) {
    console.error('[通知] メール送信エラー:', error.message);
    return false;
  }
}

/**
 * 連続失敗アラートを送信
 * @param {string} siteName - サイト名
 * @param {number} failureCount - 連続失敗回数
 * @param {string} lastError - 最後のエラーメッセージ
 */
async function sendFailureAlert(siteName, failureCount, lastError) {
  await sendEmailNotification({
    type: 'consecutive_failures',
    message: `${siteName} のスクレイピングが ${failureCount} 回連続で失敗しています。\n` +
             `サイト構造が変更された可能性があります。\n` +
             `確認をお願いします。`,
    details: {
      サイト名: siteName,
      連続失敗回数: failureCount,
      最後のエラー: lastError || '不明'
    }
  });
}

/**
 * AI Visionフォールバック通知を送信
 * @param {string} siteName - サイト名
 * @param {number} slots - 取得した空き枠数
 */
async function sendFallbackNotification(siteName, slots) {
  await sendEmailNotification({
    type: 'ai_fallback',
    message: `${siteName} のDOM解析に失敗し、AI Vision（Gemini）にフォールバックしました。\n` +
             `データは正常に取得できましたが、サイト構造が変更された可能性があります。`,
    details: {
      サイト名: siteName,
      フォールバック方式: 'Gemini Vision API',
      取得した空き枠数: slots
    }
  });
}

/**
 * 復旧通知を送信
 * @param {string} siteName - サイト名
 */
async function sendRecoveryNotification(siteName) {
  await sendEmailNotification({
    type: 'recovery',
    message: `${siteName} のスクレイピングが復旧しました。`,
    details: {
      サイト名: siteName,
      ステータス: '正常'
    }
  });
}

/**
 * デイリーサマリーを送信
 * @param {Object} summary - ヘルスサマリー
 */
async function sendDailySummary(summary) {
  if (!summary.unhealthySites.length) {
    // 全サイト正常の場合は送信しない
    return;
  }

  let message = `本日のスクレイピングヘルスサマリー\n\n`;
  message += `正常サイト数: ${summary.healthySites}/${summary.totalSites}\n\n`;

  if (summary.unhealthySites.length > 0) {
    message += '【異常検知サイト】\n';
    for (const site of summary.unhealthySites) {
      message += `・${site.name}: 連続失敗 ${site.consecutiveFailures} 回\n`;
    }
  }

  await sendEmailNotification({
    type: 'daily_summary',
    message,
    details: {
      総サイト数: summary.totalSites,
      正常サイト数: summary.healthySites,
      異常サイト数: summary.unhealthySites.length
    }
  });
}

/**
 * テスト用: メール送信テスト
 */
async function testEmailConnection() {
  const transport = getTransporter();

  if (!transport) {
    console.log('[テスト] SMTP設定がありません');
    return false;
  }

  try {
    await transport.verify();
    console.log('[テスト] SMTP接続成功');
    return true;
  } catch (error) {
    console.error('[テスト] SMTP接続失敗:', error.message);
    return false;
  }
}

module.exports = {
  sendEmailNotification,
  sendFailureAlert,
  sendFallbackNotification,
  sendRecoveryNotification,
  sendDailySummary,
  testEmailConnection,
  getConfig
};
