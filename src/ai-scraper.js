/**
 * AI Vision APIを使ったスクレイピング
 * スクリーンショットからAIが空き状況を読み取る
 * Google Gemini Vision APIを使用
 *
 * 自己修復機能: DOM解析失敗時にHTMLからセレクター候補を生成
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// Google AIクライアント
let client = null;

function getClient() {
  if (!client && process.env.GOOGLE_API_KEY) {
    client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  }
  return client;
}

/**
 * スクリーンショットから空き状況を解析
 * @param {Buffer} screenshotBuffer - スクリーンショットのバッファ
 * @param {string} siteName - サイト名
 * @param {string} targetDate - 対象日付 (YYYY-MM-DD)
 * @returns {Object} 空き状況データ
 */
async function analyzeScreenshot(screenshotBuffer, siteName, targetDate) {
  const genAI = getClient();

  if (!genAI) {
    console.log('GOOGLE_API_KEY not set, skipping AI analysis');
    return null;
  }

  const base64Image = screenshotBuffer.toString('base64');

  // 汎用的なプロンプト（カレンダー全体を読み取る）
  const prompt = `この画像はサウナ施設の予約カレンダーです。
カレンダーに表示されている全ての日付と時間枠の空き状況を読み取ってください。

【判定基準】
- 価格が表示されている枠 → 予約可能（空きあり）
- 「×」マークや「-」がある枠 → 予約不可（空きなし）
- グレーアウトされている枠 → 予約不可

【出力形式】
以下のJSON形式で、全ての日付の空き状況を出力してください：
{
  "dates": {
    "01/06": ["12:10", "14:40"],
    "01/07": ["9:40", "12:10", "14:40"],
    "01/08": []
  }
}

注意：
- 日付はカレンダーに表示されている形式（例：01/06）で出力
- 時間は開始時間のみ（例：9:40、12:10）
- 空きがない日は空配列 []
- JSONのみ出力、説明不要`;

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.1  // 確実性重視
      }
    });

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'image/png',
          data: base64Image
        }
      },
      prompt
    ]);

    const response = await result.response;
    const text = response.text();

    // JSONを抽出
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // 新形式→旧形式に変換（互換性維持）
      if (parsed.dates) {
        // targetDateからMM/DD形式を抽出
        const dateParts = targetDate.split('-');
        const mmdd = `${dateParts[1]}/${dateParts[2]}`;

        const slots = parsed.dates[mmdd] || [];
        return {
          date: targetDate,
          rooms: [{
            name: 'サウナ',
            availableSlots: slots
          }]
        };
      }

      return parsed;
    }

    return null;
  } catch (error) {
    console.error(`AI解析エラー (${siteName}):`, error.message);
    return null;
  }
}

/**
 * 複数のスクリーンショットから空き状況を一括解析
 * @param {Array} screenshots - [{buffer, siteName, date}]
 * @returns {Object} サイトごとの空き状況
 */
async function analyzeMultipleScreenshots(screenshots) {
  const results = {};

  for (const ss of screenshots) {
    const result = await analyzeScreenshot(ss.buffer, ss.siteName, ss.date);
    if (result) {
      results[ss.siteName] = result;
    }
  }

  return results;
}

// セレクターキャッシュのパス
const SELECTOR_CACHE_DIR = path.join(__dirname, '..', 'cache');
const SELECTOR_CACHE_FILE = path.join(SELECTOR_CACHE_DIR, 'selectors.json');

/**
 * セレクターキャッシュを読み込む
 * @returns {Object} キャッシュデータ
 */
function loadSelectorCache() {
  if (!fs.existsSync(SELECTOR_CACHE_DIR)) {
    fs.mkdirSync(SELECTOR_CACHE_DIR, { recursive: true });
  }

  if (fs.existsSync(SELECTOR_CACHE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SELECTOR_CACHE_FILE, 'utf-8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

/**
 * セレクターキャッシュを保存
 * @param {Object} cache - キャッシュデータ
 */
function saveSelectorCache(cache) {
  if (!fs.existsSync(SELECTOR_CACHE_DIR)) {
    fs.mkdirSync(SELECTOR_CACHE_DIR, { recursive: true });
  }
  fs.writeFileSync(SELECTOR_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * HTMLソースからセレクター候補を生成（自己修復用）
 * @param {string} htmlSource - ページのHTMLソース
 * @param {string} siteName - サイト名
 * @returns {Object} セレクター候補 { calendarSelector, slotSelector, availabilityIndicator }
 */
async function analyzeSelectorFromHtml(htmlSource, siteName) {
  const genAI = getClient();

  if (!genAI) {
    console.log('GOOGLE_API_KEY not set, skipping selector analysis');
    return null;
  }

  // HTMLが大きすぎる場合は先頭部分のみ使用
  const truncatedHtml = htmlSource.length > 50000
    ? htmlSource.substring(0, 50000) + '\n... (truncated)'
    : htmlSource;

  const prompt = `以下はサウナ施設の予約カレンダーページのHTMLソースです。
このHTMLから、予約カレンダーの空き状況を取得するためのCSSセレクターを分析してください。

【分析ポイント】
1. カレンダー全体を含む要素（table, div等）
2. 各時間枠（スロット）を表す要素
3. 空き/満席を示す要素や属性（class, data属性, 価格表示など）

【出力形式】
以下のJSON形式で出力してください：
{
  "calendarContainer": "カレンダー全体のセレクター",
  "slotSelector": "各時間枠のセレクター",
  "availabilityCheck": {
    "type": "attribute|class|text|element",
    "selector": "空きを示すセレクター",
    "value": "空きの場合の値（該当する場合）"
  },
  "dateExtractor": {
    "selector": "日付を含む要素のセレクター",
    "format": "日付のフォーマット説明"
  },
  "timeExtractor": {
    "selector": "時間を含む要素のセレクター"
  },
  "confidence": 0.8,
  "notes": "分析のメモや注意点"
}

HTMLソース:
${truncatedHtml}

JSONのみ出力、説明不要:`;

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.2
      }
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // キャッシュに保存
      const cache = loadSelectorCache();
      cache[siteName] = {
        selectors: parsed,
        updatedAt: new Date().toISOString()
      };
      saveSelectorCache(cache);

      console.log(`[自己修復] ${siteName} のセレクター候補を生成しました`);
      return parsed;
    }

    return null;
  } catch (error) {
    console.error(`セレクター分析エラー (${siteName}):`, error.message);
    return null;
  }
}

/**
 * キャッシュされたセレクターを取得
 * @param {string} siteName - サイト名
 * @returns {Object|null} キャッシュされたセレクター
 */
function getCachedSelector(siteName) {
  const cache = loadSelectorCache();
  if (cache[siteName]) {
    // 7日以上古いキャッシュは無効
    const updatedAt = new Date(cache[siteName].updatedAt);
    const now = new Date();
    const daysDiff = (now - updatedAt) / (1000 * 60 * 60 * 24);

    if (daysDiff < 7) {
      return cache[siteName].selectors;
    }
  }
  return null;
}

/**
 * 自己修復レポートを生成
 * @param {string} siteName - サイト名
 * @param {string} htmlSource - HTMLソース
 * @param {Object} currentSelectors - 現在使用中のセレクター
 * @returns {Object} 修復レポート
 */
async function generateRepairReport(siteName, htmlSource, currentSelectors) {
  const newSelectors = await analyzeSelectorFromHtml(htmlSource, siteName);

  if (!newSelectors) {
    return {
      success: false,
      message: 'セレクター分析に失敗しました'
    };
  }

  return {
    success: true,
    siteName,
    currentSelectors,
    suggestedSelectors: newSelectors,
    confidence: newSelectors.confidence || 0,
    notes: newSelectors.notes,
    generatedAt: new Date().toISOString()
  };
}

/**
 * キャッシュをクリア
 * @param {string} siteName - サイト名（指定しない場合は全てクリア）
 */
function clearSelectorCache(siteName = null) {
  if (siteName) {
    const cache = loadSelectorCache();
    delete cache[siteName];
    saveSelectorCache(cache);
  } else {
    saveSelectorCache({});
  }
}

module.exports = {
  analyzeScreenshot,
  analyzeMultipleScreenshots,
  getClient,
  // 自己修復機能
  analyzeSelectorFromHtml,
  getCachedSelector,
  generateRepairReport,
  clearSelectorCache
};
