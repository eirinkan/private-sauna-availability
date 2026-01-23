/**
 * macOSデスクトップ通知モジュール
 * AppleScriptを使用して通知センターに通知を送信
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// 実行済みフラグファイルのパス
const FLAG_DIR = path.join(__dirname, '../logs');
const getFlagPath = (date) => path.join(FLAG_DIR, `.daily-check-done-${date}`);

/**
 * 今日すでに実行済みかチェック
 */
function isAlreadyExecutedToday() {
  const today = new Date().toISOString().split('T')[0];
  const flagPath = getFlagPath(today);
  return fs.existsSync(flagPath);
}

/**
 * 実行済みフラグを作成
 */
function markAsExecuted() {
  const today = new Date().toISOString().split('T')[0];
  const flagPath = getFlagPath(today);

  // logsディレクトリがなければ作成
  if (!fs.existsSync(FLAG_DIR)) {
    fs.mkdirSync(FLAG_DIR, { recursive: true });
  }

  // フラグファイルを作成
  fs.writeFileSync(flagPath, new Date().toISOString());
  console.log(`[フラグ] 実行済みマーク作成: ${flagPath}`);

  // 古いフラグファイルを削除（7日より前のもの）
  cleanOldFlags();
}

/**
 * 古いフラグファイルを削除
 */
function cleanOldFlags() {
  const files = fs.readdirSync(FLAG_DIR);
  const now = new Date();

  for (const file of files) {
    if (!file.startsWith('.daily-check-done-')) continue;

    const dateStr = file.replace('.daily-check-done-', '');
    const fileDate = new Date(dateStr);
    const daysDiff = (now - fileDate) / (1000 * 60 * 60 * 24);

    if (daysDiff > 7) {
      const filePath = path.join(FLAG_DIR, file);
      fs.unlinkSync(filePath);
      console.log(`[クリーンアップ] 古いフラグ削除: ${file}`);
    }
  }
}

/**
 * macOSデスクトップ通知を送信
 * @param {string} title - 通知タイトル
 * @param {string} message - 通知メッセージ
 * @param {string} subtitle - サブタイトル（オプション）
 * @param {string} sound - 通知音（オプション: "default", "Basso", "Blow", "Bottle", "Frog", "Funk", "Glass", "Hero", "Morse", "Ping", "Pop", "Purr", "Sosumi", "Submarine", "Tink"）
 */
function sendDesktopNotification(title, message, subtitle = '', sound = 'default') {
  return new Promise((resolve, reject) => {
    // AppleScriptでエスケープが必要な文字を処理
    const escapeForAppleScript = (str) => {
      return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    };

    const escapedTitle = escapeForAppleScript(title);
    const escapedMessage = escapeForAppleScript(message);
    const escapedSubtitle = escapeForAppleScript(subtitle);

    let script = `display notification "${escapedMessage}" with title "${escapedTitle}"`;

    if (subtitle) {
      script += ` subtitle "${escapedSubtitle}"`;
    }

    if (sound) {
      script += ` sound name "${sound}"`;
    }

    exec(`osascript -e '${script}'`, (error, stdout, stderr) => {
      if (error) {
        console.error('[デスクトップ通知] エラー:', error.message);
        reject(error);
      } else {
        console.log('[デスクトップ通知] 送信成功');
        resolve(true);
      }
    });
  });
}

/**
 * ヘルスチェック結果を通知
 * @param {object} results - チェック結果
 */
async function notifyHealthCheckResult(results) {
  const date = results.date;
  const totalSlots = results.facilities.reduce((sum, f) => sum + f.totalSlots, 0);
  const facilityCount = results.facilities.length;

  let title, message, subtitle, sound;

  if (results.hasError) {
    // エラーがある場合
    title = '⚠️ サウナチェッカー - エラー検出';
    subtitle = `${date} のチェック結果`;
    message = results.errors.join('\n').substring(0, 200); // 長すぎる場合は切り詰め
    sound = 'Basso'; // 警告音
  } else if (results.hasWarning) {
    // 警告がある場合
    title = '⚡ サウナチェッカー - 警告';
    subtitle = `${date} のチェック結果`;
    message = results.warnings.join('\n').substring(0, 200);
    sound = 'Purr';
  } else {
    // 正常の場合
    title = '✅ サウナチェッカー - 正常';
    subtitle = `${date} のチェック結果`;
    message = `${facilityCount}施設、合計${totalSlots}枠の空きあり`;
    sound = 'Glass';
  }

  try {
    await sendDesktopNotification(title, message, subtitle, sound);
    return true;
  } catch (error) {
    console.error('[通知エラー]', error.message);
    return false;
  }
}

module.exports = {
  sendDesktopNotification,
  notifyHealthCheckResult,
  isAlreadyExecutedToday,
  markAsExecuted
};
