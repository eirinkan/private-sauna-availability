/**
 * FlareSolverr クライアント
 * Cloudflare対策を突破してHTMLを取得
 *
 * FlareSolverrの起動:
 * docker run -p 8191:8191 flaresolverr/flaresolverr
 */

const axios = require('axios');

// FlareSolverrのURL（環境変数で設定可能）
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://localhost:8191/v1';

// タイムアウト設定（Cloudflareチャレンジ解決に時間がかかる）
const TIMEOUT = 60000; // 60秒

/**
 * FlareSolverrを使ってページのHTMLを取得
 * @param {string} url - 取得するURL
 * @param {number} maxTimeout - 最大待機時間（ミリ秒）
 * @returns {Promise<{html: string, cookies: Array}>}
 */
async function getPageHtml(url, maxTimeout = TIMEOUT) {
  try {
    const response = await axios.post(FLARESOLVERR_URL, {
      cmd: 'request.get',
      url: url,
      maxTimeout: maxTimeout
    }, {
      timeout: maxTimeout + 10000, // axios側のタイムアウトは少し長めに
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data.status === 'ok') {
      return {
        html: response.data.solution.response,
        cookies: response.data.solution.cookies || [],
        userAgent: response.data.solution.userAgent
      };
    } else {
      throw new Error(`FlareSolverr error: ${response.data.message}`);
    }
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error('FlareSolverrに接続できません。docker run -p 8191:8191 flaresolverr/flaresolverr で起動してください。');
    }
    throw error;
  }
}

/**
 * FlareSolverrが利用可能かチェック
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  try {
    const response = await axios.get(FLARESOLVERR_URL.replace('/v1', '/health'), {
      timeout: 5000
    });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

/**
 * セッションを作成（複数リクエストでクッキーを共有）
 * @param {string} sessionId - セッションID
 * @returns {Promise<boolean>}
 */
async function createSession(sessionId) {
  try {
    const response = await axios.post(FLARESOLVERR_URL, {
      cmd: 'sessions.create',
      session: sessionId
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return response.data.status === 'ok';
  } catch (error) {
    console.error('セッション作成エラー:', error.message);
    return false;
  }
}

/**
 * セッションを削除
 * @param {string} sessionId - セッションID
 * @returns {Promise<boolean>}
 */
async function destroySession(sessionId) {
  try {
    const response = await axios.post(FLARESOLVERR_URL, {
      cmd: 'sessions.destroy',
      session: sessionId
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return response.data.status === 'ok';
  } catch (error) {
    console.error('セッション削除エラー:', error.message);
    return false;
  }
}

/**
 * セッションを使ってページのHTMLを取得
 * @param {string} url - 取得するURL
 * @param {string} sessionId - セッションID
 * @param {number} maxTimeout - 最大待機時間（ミリ秒）
 * @returns {Promise<{html: string, cookies: Array}>}
 */
async function getPageHtmlWithSession(url, sessionId, maxTimeout = TIMEOUT) {
  try {
    const response = await axios.post(FLARESOLVERR_URL, {
      cmd: 'request.get',
      url: url,
      session: sessionId,
      maxTimeout: maxTimeout
    }, {
      timeout: maxTimeout + 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data.status === 'ok') {
      return {
        html: response.data.solution.response,
        cookies: response.data.solution.cookies || [],
        userAgent: response.data.solution.userAgent
      };
    } else {
      throw new Error(`FlareSolverr error: ${response.data.message}`);
    }
  } catch (error) {
    throw error;
  }
}

module.exports = {
  getPageHtml,
  getPageHtmlWithSession,
  isAvailable,
  createSession,
  destroySession
};
