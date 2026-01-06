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

module.exports = { analyzeScreenshot, analyzeMultipleScreenshots, getClient };
