# 店舗追加ルール

プライベートサウナ空き状況チェッカーに新しい店舗を追加する際の手順です。

---

## 1. 全体構成

```
src/
├── scraper.js          # メインスクレイパー（施設一覧・実行順序）
├── server.js           # APIサーバー
├── pricing.js          # 料金データ
├── sites/              # 各予約システム別スクレイパー
│   ├── reserva.js      # RESERVA系
│   ├── hacomono.js     # hacomono系
│   ├── coubic.js       # Coubic系
│   ├── gflow.js        # gflow系
│   └── ...
public/
└── index.html          # フロントエンド（表示・料金計算）
```

---

## 2. 店舗追加の5ステップ

### Step 1: 予約システムを特定する

まず、その店舗が使っている予約システムを確認：

| 予約システム | URL例 | 既存スクレイパー |
|-------------|-------|-----------------|
| RESERVA | `reserva.be/xxx` | `sites/reserva.js` |
| hacomono | `xxx.hacomono.jp` | `sites/hacomono.js` |
| Coubic | `coubic.com/xxx` | `sites/coubic.js` |
| gflow | `sw.gflow.cloud/xxx` | `sites/gflow.js` |
| spot-ly | `spot-ly.jp/xxx` | `sites/myaku.js` |
| 独自システム | - | 新規作成が必要 |

**既存システムなら既存スクレイパーに追加、新規システムなら新しいスクレイパーを作成。**

---

### Step 2: スクレイパーを作成/修正

#### 既存システムに追加する場合（例：RESERVA）

`src/sites/reserva.js` に部屋情報を追加：

```javascript
// 新店舗の部屋一覧
const NEW_STORE_ROOMS = [
  {
    url: 'https://reserva.be/xxx/reserve?...',
    name: '部屋名（時間/定員）¥価格'  // 統一フォーマット
  }
];

// 新しいscrape関数をexport
async function scrapeNewStore(browser) {
  return await scrapeRooms(browser, NEW_STORE_ROOMS, 'new_store');
}

module.exports = {
  scrapeMiamitenjin,
  scrapeTenjin,
  scrapeNewStore  // 追加
};
```

#### 新規システムの場合

`src/sites/newsite.js` を新規作成：

```javascript
/**
 * 新店舗スクレイパー
 * URL: https://...
 */

async function scrape(browser) {
  const page = await browser.newPage();

  try {
    // 結果の構造（必須）
    const result = { dates: {} };

    // スクレイピング処理...
    // result.dates['2026-01-07']['部屋名'] = ['10:00〜12:00', '13:00〜15:00'];

    return result;
  } finally {
    await page.close();
  }
}

module.exports = { scrape };
```

**返り値の構造（必須）：**
```javascript
{
  dates: {
    '2026-01-07': {
      '部屋名（時間/定員）¥価格': ['10:00〜12:00', '13:00〜15:00']
    },
    '2026-01-08': {
      '部屋名（時間/定員）¥価格': ['09:00〜11:00']
    }
  }
}
```

---

### Step 3: scraper.js に登録

`src/scraper.js` を編集：

```javascript
// 1. スクレイパーをimport
const newsite = require('./sites/newsite');

// 2. scrapeAll() 関数内に追加
console.log('  - 新店舗 スクレイピング中...');
try {
  data.facilities.newStore = await scrapeWithMonitoring('newStore', newsite.scrape, browser);
} catch (e) {
  console.error('    新店舗 エラー:', e.message);
  data.facilities.newStore = { error: e.message };
}

// 3. facilityInfo 配列に追加（getAvailability関数内）
const facilityInfo = [
  // ... 既存施設 ...
  {
    key: 'newStore',                    // data.facilities のキー
    name: '新店舗名',                    // 表示名
    url: 'https://スクレイピング元URL',   // 空き状況を取得しているページURL
    hpUrl: 'https://公式サイト',         // 公式HP URL
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=店舗名+地域'  // Google Maps検索URL
  }
];
```

---

### Step 4: フロントエンド（料金計算）を更新

`public/index.html` の `guestPricing` オブジェクトに追加：

```javascript
const guestPricing = {
  // ... 既存施設 ...

  // 新店舗
  '部屋名': {
    capacity: 2,           // 定員
    base: 5000,            // 基本料金
    additional: 2000       // 追加1名あたり（オプション）
  },
  // または平日/週末で分ける場合
  '部屋名2': {
    capacity: 4,
    weekday: 6000,
    weekend: 8000
  }
};
```

**料金計算のパターン：**

| パターン | 設定例 |
|---------|--------|
| 固定料金 | `{ capacity: 2, base: 5000 }` |
| 平日/週末 | `{ capacity: 2, weekday: 5000, weekend: 6000 }` |
| 追加人数 | `{ capacity: 2, base: 5000, additional: 2000 }` |
| 夜間料金 | `{ capacity: 2, base: 5000, nightBase: 8000 }` |

---

### Step 5: pricing.js に追加（オプション）

`src/pricing.js` に詳細料金を追加（API経由で料金情報を提供する場合）：

```javascript
const PRICING = {
  // ... 既存施設 ...

  newStore: {
    name: '新店舗名',
    url: 'https://予約URL',
    note: '備考（例：平日/土日で料金が異なる）',
    plans: [
      { name: 'プラン名', price: 5000, duration: 120, capacity: 2 }
    ]
  }
};
```

---

## 3. URL設定ルール

| フィールド | 内容 | 例 |
|-----------|------|-----|
| `url` | スクレイピング元のURL（予約ボタンのリンク先） | `https://reserva.be/xxx/reserve?...` |
| `hpUrl` | 公式サイトURL（施設名タップ時） | `https://example-sauna.com/` |
| `mapUrl` | Google Maps検索URL（📍アイコン） | `https://www.google.com/maps/search/?api=1&query=店舗名+地域` |

**Google Maps URL生成方法：**
```
https://www.google.com/maps/search/?api=1&query=店舗名+地域名
```
例: `https://www.google.com/maps/search/?api=1&query=KUDOCHI+福岡中洲`

---

## 4. 部屋名のフォーマット（統一ルール）

```
部屋名（時間/定員N名）¥最低価格-最高価格
```

**例：**
- `「陽」光の陽彩（120分/定員7名）¥6,600-11,000`
- `BASE（120分/定員2名）¥6,500-10,800`
- `Silk（90分/定員2名）¥6,000`

---

## 5. 予約システム別のポイント

### RESERVA (`reserva.be`)
- Cloudflare対策が必要（FlareSolverr or AI Vision）
- `input.timebox` 要素に空き情報あり
- `data-targetgroup`: 日付, `data-time`: 時間, `data-vacancy`: 空き状態

### hacomono
- APIで直接取得可能
- カレンダーはシンプルなDOM構造

### Coubic
- ラジオボタンのvalue属性にISO形式タイムスタンプ
- UTC→JST変換が必要（+9時間）
- 平日/土日プランが分かれている場合あり

### gflow
- iframeでカレンダー表示
- 空き状況はボタンの色/状態で判定

---

## 6. チェックリスト

新店舗追加時の確認項目：

- [ ] 予約システムを特定した
- [ ] スクレイパーを作成/修正した
- [ ] `scraper.js` にimportと実行コードを追加した
- [ ] `scraper.js` の `facilityInfo` に店舗情報を追加した
- [ ] `public/index.html` の `guestPricing` に料金を追加した
- [ ] ローカルで動作確認した
- [ ] コミット＆プッシュした

---

## 7. デバッグ

### ローカルテスト
```bash
npm run dev
# http://localhost:3000 で確認
```

### スクレイピングのみテスト
```bash
node -e "const {scrapeAll} = require('./src/scraper'); scrapeAll().then(console.log)"
```

### Cloud Run確認
- 手動更新: `https://[CLOUD_RUN_URL]/api/refresh`
- Puppeteer診断: `https://[CLOUD_RUN_URL]/api/debug/puppeteer`
