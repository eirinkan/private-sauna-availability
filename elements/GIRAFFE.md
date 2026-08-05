# GIRAFFE (RESERVA) スクレイピング要素メモ

URL: https://reserva.be/giraffe_minamitenjin

## 概要
- サイト: reserva.be（RESERVA予約システム）
- 認証: ログイン不要
- Cloudflare保護: あり（FlareSolverr必須）

## 店舗・部屋情報

※南天神店（和の静寂／温冷交互）は追跡対象から削除済み（2026-08-05）。天神店のみ取得する。

### GIRAFFE 天神店
1. 「陽」光の陽彩（120分/定員7名）¥6,600-11,000
2. 「陰」静の陰影（120分/定員4名）¥7,700-11,000
3. 「陽」光の陽彩（night/定員2名）¥11,000-19,800
4. 「陰」静の陰影（night/定員2名）¥12,100-20,900

公式サイト（https://sauna-giraffe.com/tenjin/）記載の料金:
- 120分: 平日 ¥6,600〜 / 土日祝 ¥7,700〜
- ナイトパック（8時間 24:30〜翌8:30）: 月火水木 ¥11,000〜 / 金土日祝 ¥14,300〜
- 1名まで上記料金、2名以上は1名追加 ¥3,300（ナイトパックは ¥5,500）

---

## DOM要素

### 部屋名
```html
<div class="menu-detail__header has-share">
  <h3 class="menu-detail__title">○ 和の静寂【120分】</h3>
</div>
```

### カレンダー構造
```html
<div class="cal-timeframe">
  <!-- カレンダータイトル -->
  <div class="cal__title">
    <span class="cal__title__label">2026年01月</span>
  </div>

  <!-- カレンダーヘッダー（日付） -->
  <div class="cal__head cal-timeframe__head">
    <div class="cal__head__day">
      <div class="date">01/11</div>
      <div class="dayofweek">日</div>
    </div>
    ...
  </div>

  <!-- カレンダー本体 -->
  <div class="cal-timeframe__body">
    <div class="cal-timeframe__row">
      <!-- 各時間枠 -->
    </div>
  </div>
</div>
```

### 空いている時間帯
```html
<div class="cal-timeframe__cell cal-timeframe__cell--data change-color__selected02">
  <input type="checkbox"
         name="userselect_datetime"
         class="timebox"
         id="2026-01-14-27"
         data-targetgroup="2026-01-14"
         data-time="21:00～23:00"
         data-price="8800.00"
         data-vacancy="1">
  <label for="2026-01-14-27" class="cal-timeframe__item">
    <div class="item-label">21:00～23:00</div>
    <div class="item-price">¥8,800</div>
    <div class="item-vacancy">
      <i class="icon-circle"></i>
    </div>
  </label>
</div>
```

### 埋まっている時間帯
```html
<div class="cal-timeframe__cell cal-timeframe__cell--data">
  <div data-group="2026-01-15"
       data-frameid="2026-01-15-32"
       class="cal-timeframe__item is-unavailable">
    <div class="item-label">16:00～18:00</div>
    <div class="item-price">¥7,700</div>
    <div class="item-vacancy">
      <i class="icon-times"></i>
    </div>
  </div>
</div>
```

---

## 重要なセレクタ

| 要素 | セレクタ |
|------|----------|
| 空き枠 | `input.timebox[data-vacancy="1"]` |
| 日付 | `input.timebox` の `data-targetgroup` 属性 |
| 時間 | `input.timebox` の `data-time` 属性 |
| 価格 | `input.timebox` の `data-price` 属性 |
| 埋まり判定 | `.cal-timeframe__item.is-unavailable` |

---

## スクレイピング方法

### 空き枠の取得
```javascript
const timeboxInputs = document.querySelectorAll('input.timebox');

timeboxInputs.forEach(input => {
  const targetGroup = input.dataset.targetgroup; // "2026-01-06"
  const time = input.dataset.time; // "09:30～11:30"
  const vacancy = input.dataset.vacancy;

  if (targetGroup && time && vacancy === '1') {
    // 空き枠として処理
  }
});
```

### フォールバック（.is-unavailable を除外）
```javascript
const cells = document.querySelectorAll('.cal-timeframe__item:not(.is-unavailable)');
```

---

## 注意事項

1. **Cloudflare保護**: FlareSolverrなしではスクレイピング不可
2. **ページタイトル検出**: "Just a moment..." = Cloudflareチャレンジ
3. **待機時間**: ページ読み込み後5秒待機、timebox要素出現まで20秒待機
4. **時間形式**: `08:30～10:30` 形式（全角チルダ）
5. **日付形式**: `2026-01-14` 形式（ISO 8601）

---

## FlareSolverr設定

本番環境では以下が必要:
- Docker: `docker run -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest`
- または環境変数 `FLARESOLVERR_URL=http://flaresolverr:8191/v1`
