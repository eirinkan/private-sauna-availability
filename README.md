# 福岡プライベートサウナ空き状況チェッカー

福岡市内のプライベートサウナ8施設の空き状況を自動取得し、一覧表示するWebアプリケーション。

## 対象施設

| 施設名 | 予約システム |
|--------|-------------|
| KUDOCHI福岡中洲 | hacomono |
| SAUNA SAKURADO | 独自システム |
| GIRAFFE 南天神 | RESERVA |
| GIRAFFE 天神 | RESERVA |
| SAUNA OOO FUKUOKA | gflow |
| BASE Private sauna | Coubic |
| 脈 MYAKU | spot-ly |
| サウナヨーガン福岡天神 | RESERVA |

## 技術スタック

- **バックエンド**: Node.js + Express
- **スクレイピング**: Puppeteer + puppeteer-extra-plugin-stealth
- **Cloudflare対策**: FlareSolverr（オプション）
- **AI解析フォールバック**: Google Gemini Vision API（オプション）
- **デプロイ**: Google Cloud Run

## ローカル開発

### 必要環境

- Node.js 20以上
- npm

### セットアップ

```bash
# 依存関係インストール
npm install

# 環境変数設定（オプション）
cp .env.example .env
# .envを編集してGOOGLE_API_KEYを設定（AI解析機能を使う場合のみ）

# 開発サーバー起動
npm run dev
```

### 動作確認

```bash
# ヘルスチェック
curl http://localhost:3000/api/health

# 空き状況取得（今日）
curl http://localhost:3000/api/availability

# 空き状況取得（日付指定）
curl http://localhost:3000/api/availability?date=2025-01-10

# 手動スクレイピング実行
curl -X POST http://localhost:3000/api/refresh
```

## Cloud Runデプロイ

### 前提条件

- Google Cloud アカウント
- gcloud CLI インストール済み
- プロジェクト作成済み

### デプロイ手順

```bash
# 1. gcloud認証
gcloud auth login

# 2. プロジェクト設定
gcloud config set project YOUR_PROJECT_ID

# 3. Artifact Registryリポジトリ作成（初回のみ）
gcloud artifacts repositories create docker-repo \
  --repository-format=docker \
  --location=asia-northeast1

# 4. Docker認証設定
gcloud auth configure-docker asia-northeast1-docker.pkg.dev

# 5. イメージビルド＆プッシュ
docker build -t asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/docker-repo/private-sauna-availability .
docker push asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/docker-repo/private-sauna-availability

# 6. Cloud Runデプロイ
gcloud run deploy private-sauna-availability \
  --image asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/docker-repo/private-sauna-availability \
  --region asia-northeast1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi \
  --timeout 900 \
  --min-instances 1 \
  --max-instances 1
```

### 重要な設定値

| 設定 | 値 | 理由 |
|------|-----|------|
| memory | 2Gi | Puppeteer/Chromium起動に必要 |
| timeout | 900秒 | 8施設のスクレイピングに8-10分かかる |
| min-instances | 1 | データ永続化（エフェメラルFS対策） |
| max-instances | 1 | 同一インスタンスでデータ保持 |

## Cloud Scheduler設定（定期実行）

```bash
# 15分ごとにスクレイピング実行
gcloud scheduler jobs create http sauna-refresh-job \
  --location=asia-northeast1 \
  --schedule="*/15 * * * *" \
  --uri="https://YOUR_CLOUD_RUN_URL/api/refresh" \
  --http-method=POST \
  --oidc-service-account-email=YOUR_SERVICE_ACCOUNT@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

## API エンドポイント

| エンドポイント | メソッド | 説明 |
|---------------|---------|------|
| `/api/health` | GET | ヘルスチェック |
| `/api/availability` | GET | 空き状況取得（?date=YYYY-MM-DD） |
| `/api/refresh` | POST/GET | スクレイピング実行 |
| `/api/pricing` | GET | 料金情報取得 |

## プロジェクト構成

```
.
├── Dockerfile          # Cloud Run用Dockerファイル
├── package.json        # 依存関係
├── .env.example        # 環境変数テンプレート
├── public/             # 静的ファイル（フロントエンド）
│   └── index.html
├── src/
│   ├── server.js       # Expressサーバー
│   ├── scraper.js      # スクレイピング統括
│   ├── pricing.js      # 料金データ
│   ├── ai-scraper.js   # AI Vision解析（フォールバック）
│   ├── flaresolverr.js # Cloudflare対策
│   └── sites/          # 各サイト用スクレイパー
│       ├── sakurado.js
│       ├── reserva.js  # GIRAFFE, サウナヨーガン
│       ├── hacomono.js # KUDOCHI
│       ├── gflow.js    # SAUNA OOO
│       ├── coubic.js   # BASE
│       ├── myaku.js    # 脈
│       └── yogan.js    # サウナヨーガン
└── data/               # スクレイピング結果保存
    └── availability.json
```

## 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| PORT | No | サーバーポート（デフォルト: 3000） |
| GOOGLE_API_KEY | No | Gemini Vision API キー（AI解析用） |

## 注意事項

- スクレイピングは各サイトの利用規約を確認の上、適切な頻度で実行してください
- Cloud Runのmin/max-instances=1設定は、ローカルファイルシステムでのデータ永続化のために必要です
- 本格運用時はCloud StorageやFirestoreなど永続的なストレージへの移行を推奨します

## ライセンス

ISC
