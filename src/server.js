require('dotenv').config();

const express = require('express');
const path = require('path');
const cron = require('node-cron');
const { scrapeAll, getAvailability } = require('./scraper');
const { PRICING } = require('./pricing');

const app = express();
const PORT = process.env.PORT || 3000;

// 静的ファイル配信
app.use(express.static(path.join(__dirname, '../public')));

// API: 空き状況取得
app.get('/api/availability', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const data = getAvailability(date);
  res.json(data);
});

// API: 手動更新トリガー
app.post('/api/refresh', async (req, res) => {
  try {
    await scrapeAll();
    res.json({ success: true, message: '更新完了' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: ヘルスチェック
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API: 料金情報取得
app.get('/api/pricing', (req, res) => {
  res.json(PRICING);
});

// 15分ごとに自動取得
cron.schedule('*/15 * * * *', async () => {
  console.log(`[${new Date().toISOString()}] 定期スクレイピング開始`);
  try {
    await scrapeAll();
    console.log(`[${new Date().toISOString()}] 定期スクレイピング完了`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] スクレイピングエラー:`, error.message);
  }
});

// サーバー起動
app.listen(PORT, async () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);

  // 起動時に初回スクレイピング実行
  console.log('初回スクレイピング開始...');
  try {
    await scrapeAll();
    console.log('初回スクレイピング完了');
  } catch (error) {
    console.error('初回スクレイピングエラー:', error.message);
  }
});
