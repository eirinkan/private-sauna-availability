FROM node:20-slim

# Puppeteer実行に必要な追加パッケージ（フォント・DBUS）
# Chromium本体とその実行時依存は npx puppeteer browsers install chrome --install-deps で入る
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-freefont-ttf \
    dbus \
    dbus-x11 \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Puppeteer管理下のChromiumを使う（Debianのchromiumパッケージには依存しない）
# → apt側の chromium 更新でPuppeteerとバージョン不整合が起きる問題を構造的に回避
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# 依存関係をインストール（npm ciでpuppeteerが同梱Chromiumも一緒にダウンロードする）
COPY package*.json ./
RUN npm ci --only=production

# Puppeteerが要求するChromium実行時ライブラリを追加インストール
# （公式Docker guideの推奨手順）
RUN npx puppeteer browsers install chrome --install-deps

# アプリケーションをコピー
COPY . .

# データディレクトリを作成
RUN mkdir -p /app/data

# Cloud RunはPORT環境変数を使用
ENV PORT=8080
EXPOSE 8080

# 起動コマンド
CMD ["npm", "start"]
