FROM node:20-slim

# Puppeteer管理下のChromium実行に必要な依存パッケージを明示インストール
# （--install-deps は apt キャッシュクリア後に走ると失敗するため使わない）
RUN apt-get update && apt-get install -y \
    ca-certificates \
    wget \
    fonts-liberation \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-freefont-ttf \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libvulkan1 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    dbus \
    dbus-x11 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Puppeteer管理下のChromiumキャッシュ場所（Cloud Runのwritableな場所）
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# 依存関係をインストール（npm ciでpuppeteerがpostinstallでChromiumを自動DLする）
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
