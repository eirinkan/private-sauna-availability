/**
 * AI Vision APIを使ったスクレイピング
 * スクリーンショットからAIが空き状況を読み取る
 * Google Gemini Vision APIを使用
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

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

  const prompt = `このスクリーンショットはサウナ施設「${siteName}」の予約カレンダーです。
${targetDate}の空き状況を読み取ってください。

以下のJSON形式で回答してください（JSONのみ、説明不要）:
{
  "date": "${targetDate}",
  "rooms": [
    {
      "name": "部屋名",
      "availableSlots": ["10:00", "14:00", "18:00"]
    }
  ]
}

注意:
- 「○」や価格表示があれば空き
- 「×」「FULL」「-」は予約不可
- 空き枠がない場合は availableSlots: []
- 部屋名が不明な場合は「サウナ」とする
- 時間は "HH:MM" 形式で開始時間のみ`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

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
      return JSON.parse(jsonMatch[0]);
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

module.exports = { analyzeScreenshot, analyzeMultipleScreenshots, getClient };
