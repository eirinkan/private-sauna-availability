FROM node:20-slim

# Puppeteer用の依存関係をインストール
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Puppeteerの設定（Chromiumのダウンロードをスキップ、システムのChromiumを使用）
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# 依存関係をインストール
COPY package*.json ./
RUN npm ci --only=production

# アプリケーションをコピー
COPY . .

# データディレクトリを作成
RUN mkdir -p /app/data

# Cloud RunはPORT環境変数を使用
ENV PORT=8080
EXPOSE 8080

# 起動コマンド
CMD ["npm", "start"]
