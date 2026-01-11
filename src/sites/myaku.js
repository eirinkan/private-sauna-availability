/**
 * 脈 -MYAKU PRIVATE SAUNA- (spot-ly) スクレイパー
 * URL: https://spot-ly.jp/ja/hotels/176
 *
 * モーダル内の時間帯ボタンから詳細な空き状況を取得
 * HTML要素のdisabled属性で判定
 */

const BASE_URL = 'https://spot-ly.jp/ja/hotels/176';

// プラン情報（順序は空室状況ページでの表示順）
const PLANS = [
  {
    name: '休 KYU（90分/定員3名）¥9,130〜',
    planTitle: '【休 -KYU-】90分プラン（午後）',
    timeSlots: ['11:30〜13:00', '13:30〜15:00', '15:30〜17:00', '17:30〜19:00', '19:30〜21:00'],
    isNight: false,
    index: 0
  },
  {
    name: '水 MIZU（night/定員2名）¥8,800〜',
    planTitle: '【水 -MIZU-】ナイトパック',
    timeSlots: ['1:00〜8:30'],
    isNight: true,
    index: 1
  },
  {
    name: '水 MIZU（90分午後/定員2名）¥6,600〜',
    planTitle: '【水 -MIZU-】90分プラン（午後）',
    timeSlots: ['13:00〜14:30', '15:00〜16:30', '17:00〜18:30', '19:00〜20:30', '21:00〜22:30', '23:00〜0:30'],
    isNight: false,
    index: 2
  },
  {
    name: '水 MIZU（90分午前/定員2名）¥6,600〜',
    planTitle: '【水 -MIZU-】90分プラン（午前）',
    timeSlots: ['9:00〜10:30', '11:00〜12:30'],
    isNight: false,
    index: 3
  },
  {
    name: '火 HI（night/定員4名）¥10,120〜',
    planTitle: '【火 -HI-】ナイトパック',
    timeSlots: ['0:30〜8:00'],
    isNight: true,
    index: 4
  },
  {
    name: '火 HI（90分午後/定員4名）¥7,150〜',
    planTitle: '【火 -HI-】90分プラン（午後）',
    timeSlots: ['14:30〜16:00', '16:30〜18:00', '18:30〜20:00', '20:30〜22:00', '22:30〜0:00'],
    isNight: false,
    index: 5
  },
  {
    name: '火 HI（90分午前/定員4名）¥7,150〜',
    planTitle: '【火 -HI-】90分プラン（午前）',
    timeSlots: ['8:30〜10:00', '10:30〜12:00', '12:30〜14:00'],
    isNight: false,
    index: 6
  }
];

async function scrape(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 900 });

  try {
    console.log('    → 脈: アクセス中...');

    const result = { dates: {} };
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // 日付パラメータ付きURLに直接アクセス（CLAUDE.md推奨の方法）
    const checkinDate = now.toISOString().split('T')[0];
    const checkoutDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const directUrl = `${BASE_URL}?checkinDatetime=${checkinDate}+00%3A00%3A00&checkoutDatetime=${checkoutDate}+00%3A00%3A00`;

    console.log(`    → 脈: 空室状況ページに直接アクセス`);
    await page.goto(directUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 5000));

    // ページの読み込み確認
    const pageTitle = await page.title();
    console.log(`    → 脈: ページタイトル = "${pageTitle}"`);

    // 最初に1回だけ、ページ上のプラン順序を確認
    const pageOrder = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button.w-\\[144px\\]');
      const order = [];
      buttons.forEach((btn, idx) => {
        // ボタンの親要素からプラン名を取得
        let parent = btn.parentElement;
        let planName = '';
        while (parent && parent.tagName !== 'BODY') {
          const text = parent.innerText || '';
          // プラン名を含む要素を探す
          const match = text.match(/【[^】]+】[^\n]+/);
          if (match) {
            planName = match[0].split('\n')[0];
            break;
          }
          parent = parent.parentElement;
        }
        order.push({ idx, planName: planName.substring(0, 30) });
      });
      return order;
    });
    console.log('    → ページ上のプラン順序:', JSON.stringify(pageOrder.slice(0, 10)));

    // 各プランを処理
    for (const plan of PLANS) {
      console.log(`    → ${plan.planTitle}: スクレイピング中...`);

      try {
        // 古いモーダルをDOMから削除
        await page.evaluate(() => {
          // 「日時を選ぶ」を含むモーダル要素を探して削除
          const allDivs = document.querySelectorAll('div');
          for (const div of allDivs) {
            if (div.innerText && div.innerText.includes('日時を選ぶ') && div.innerText.includes('この日時で予約する')) {
              const style = window.getComputedStyle(div);
              // 固定位置のモーダルのみ削除
              if (style.position === 'fixed' || style.position === 'absolute') {
                div.remove();
              }
            }
          }
        });
        await new Promise(resolve => setTimeout(resolve, 300));

        // ページ上でこのプラン名に対応するインデックスを検索
        // 午前/午後を区別するため、より長いマッチングを使用
        let matchedEntry = pageOrder.find(p => p.planName.includes(plan.planTitle.substring(0, 20)));
        if (!matchedEntry) {
          // 20文字でマッチしない場合、15文字で再試行（短いプラン名対応）
          matchedEntry = pageOrder.find(p => p.planName.includes(plan.planTitle.substring(0, 15)));
        }
        const planIndex = matchedEntry ? matchedEntry.idx : plan.index;

        // デバッグ: インデックスが正しいか確認
        if (matchedEntry) {
          console.log(`      インデックス: ${planIndex} (検出: "${matchedEntry.planName.substring(0, 25)}")`);
        }

        // まず全プランカードの情報を取得
        const planInfo = await page.evaluate((idx) => {
          const selectContainers = document.querySelectorAll('.css-b62m3t-container');
          const reserveButtons = document.querySelectorAll('button.w-\\[144px\\]');
          return {
            totalSelects: selectContainers.length,
            totalButtons: reserveButtons.length,
            targetSelectIdx: idx * 2,
            targetButtonIdx: idx
          };
        }, planIndex);

        if (planIndex >= planInfo.totalButtons) {
          console.log(`    → ${plan.planTitle}: ボタンインデックス超過 (${planIndex}/${planInfo.totalButtons})`);
          continue;
        }

        // ドロップダウンをクリックして1名を選択
        const selectIndex = planIndex * 2;
        await page.evaluate((idx) => {
          const selectContainers = document.querySelectorAll('.css-b62m3t-container');
          if (selectContainers[idx]) {
            const control = selectContainers[idx].querySelector('.css-13cymwt-control');
            if (control) {
              control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            }
          }
        }, selectIndex);
        await new Promise(resolve => setTimeout(resolve, 500));

        // 1名オプションをクリック
        await page.evaluate(() => {
          const options = document.querySelectorAll('[class*="option"]');
          for (const opt of options) {
            if (opt.innerText.trim() === '1名') {
              opt.click();
              return true;
            }
          }
          return false;
        });
        await new Promise(resolve => setTimeout(resolve, 500));

        // 予約するボタンをクリック（scrollIntoViewで確実に表示）
        const buttonClicked = await page.evaluate((idx, expectedPlanTitle) => {
          const reserveButtons = document.querySelectorAll('button.w-\\[144px\\]');
          const btn = reserveButtons[idx];

          if (btn && !btn.disabled) {
            // このボタンの親要素からプラン名を確認
            let parent = btn.parentElement;
            let foundPlanName = '';
            while (parent && parent.tagName !== 'BODY') {
              const text = parent.innerText || '';
              const match = text.match(/【[^】]+】[^\n]+/);
              if (match) {
                foundPlanName = match[0].split('\n')[0];
                break;
              }
              parent = parent.parentElement;
            }

            btn.scrollIntoView({ block: 'center' });
            btn.click();
            return {
              clicked: true,
              buttonIndex: idx,
              foundPlanName: foundPlanName.substring(0, 30),
              expectedPlanTitle: expectedPlanTitle
            };
          }
          return { clicked: false };
        }, planIndex, plan.planTitle);

        // デバッグ: クリックしたボタンのプラン名を出力
        if (buttonClicked.clicked && buttonClicked.foundPlanName) {
          const isCorrect = buttonClicked.foundPlanName.includes(plan.planTitle.substring(0, 10));
          if (!isCorrect) {
            console.log(`      [警告] ボタン${buttonClicked.buttonIndex}は「${buttonClicked.foundPlanName}」（期待: ${plan.planTitle}）`);
          }
        }

        if (!buttonClicked.clicked) {
          console.log(`    → ${plan.planTitle}: ボタンが無効です`);
          continue;
        }

        // モーダルが開くのを待つ
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 期待する時間帯を含むモーダルが表示されるまで待機
        const expectedTime = plan.timeSlots[0].split('〜')[0].trim();
        let modalReady = false;
        for (let i = 0; i < 15; i++) {
          modalReady = await page.evaluate((expTime) => {
            // モーダル内に期待する時間帯があるか確認
            const allDivs = document.querySelectorAll('div');
            for (const div of allDivs) {
              const text = div.innerText || '';
              if (text.includes('日時を選ぶ') && text.includes('この日時で予約する')) {
                // この時間帯のボタンがあるか
                const buttons = div.querySelectorAll('button');
                for (const btn of buttons) {
                  const btnText = btn.innerText.replace(/\n/g, ' ').trim();
                  // 時間を数値で比較（0:30 と 00:30 の違いに対応）
                  const match = btnText.match(/^(\d{1,2}):(\d{2})/);
                  if (match) {
                    const btnHour = parseInt(match[1]);
                    const btnMin = parseInt(match[2]);
                    const expMatch = expTime.match(/(\d{1,2}):(\d{2})/);
                    if (expMatch) {
                      const expHour = parseInt(expMatch[1]);
                      const expMin = parseInt(expMatch[2]);
                      if (btnHour === expHour && btnMin === expMin) {
                        return true;
                      }
                    }
                  }
                }
              }
            }
            return false;
          }, expectedTime);
          if (modalReady) break;
          await new Promise(r => setTimeout(r, 500));
        }
        if (!modalReady) {
          console.log(`    → ${plan.planTitle}: 正しいモーダルが開きませんでした（期待: ${expectedTime}）`);
          // ESCで閉じて次へ
          await page.keyboard.press('Escape');
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }

        // disabled属性がDOMに反映されるまで待機
        // Reactがdisabled属性を設定するまで待つ
        await page.waitForFunction(() => {
          const buttons = document.querySelectorAll('button[class*="flex-col"]');
          // 時間帯ボタンの中でdisabled=trueのものが1つでもあれば準備完了
          return Array.from(buttons).some(btn => btn.disabled === true);
        }, { timeout: 5000 }).catch(() => {
          // タイムアウトしても続行（すべて空きの可能性）
          console.log(`    → ${plan.planTitle}: disabled待機タイムアウト（全て空きの可能性）`);
        });

        // 追加の待機（DOM安定化）
        await new Promise(r => setTimeout(r, 500));

        // DOMから直接disabled状態を取得
        // モーダル内の時間帯ボタンのみを取得
        const buttonStates = await page.evaluate((planTitle, expectedTimeSlot) => {
          const results = [];

          // モーダルを特定：最後に追加されたモーダルを使う
          // DOMの順序で後ろにあるものが新しいモーダル
          const allDivs = Array.from(document.querySelectorAll('div'));

          // 「日時を選ぶ」を含むモーダル候補を全て取得
          const modalCandidates = allDivs.filter(div => {
            const text = div.innerText || '';
            return text.includes('日時を選ぶ') &&
                   text.includes('この日時で予約する');
          });

          // 最後（最新）のモーダルを使用
          let modal = null;
          for (let i = modalCandidates.length - 1; i >= 0; i--) {
            const candidate = modalCandidates[i];
            const text = candidate.innerText || '';
            // このプランのモーダルか確認
            if (text.includes(planTitle)) {
              modal = candidate;
              break;
            }
          }

          // プラン名が見つからない場合、最後のモーダルを使用
          if (!modal && modalCandidates.length > 0) {
            modal = modalCandidates[modalCandidates.length - 1];
          }

          if (!modal) {
            return { error: 'モーダルが見つかりません', planTitle };
          }

          // モーダル内の時間帯ボタンを取得
          const allButtons = modal.querySelectorAll('button');
          const timePattern = /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/;

          // 期待される時間帯の最初のパターンを抽出（例：01:00 or 1:00）
          const expectedStartTime = expectedTimeSlot.split('〜')[0].trim();
          // 時間を分に変換する関数
          const timeToMinutes = (timeStr) => {
            const match = timeStr.match(/(\d{1,2}):(\d{2})/);
            if (match) {
              return parseInt(match[1]) * 60 + parseInt(match[2]);
            }
            return -1;
          };
          const expectedMinutes = timeToMinutes(expectedStartTime);

          let foundExpectedTime = false;

          allButtons.forEach((btn) => {
            const text = btn.innerText.replace(/\n/g, ' ').trim();
            if (timePattern.test(text)) {
              // 期待する時間帯かチェック（数値で比較）
              const startTime = text.split('-')[0].trim();
              const actualMinutes = timeToMinutes(startTime);
              if (actualMinutes === expectedMinutes) {
                foundExpectedTime = true;
              }

              const isDisabled = btn.disabled === true;

              let opacityDisabled = false;
              if (!isDisabled) {
                const style = window.getComputedStyle(btn);
                opacityDisabled = parseFloat(style.opacity) < 0.9;
              }

              results.push({
                index: results.length,
                disabled: isDisabled || opacityDisabled,
                text: text
              });
            }
          });

          // 期待する時間帯が見つからない場合はエラー
          if (!foundExpectedTime && results.length > 0) {
            return {
              error: '時間帯不一致',
              expected: expectedTimeSlot,
              found: results.map(r => r.text).slice(0, 3)
            };
          }

          return results;
        }, plan.planTitle, plan.timeSlots[0]);

        // エラーチェック
        if (buttonStates.error) {
          console.log(`    → ${plan.planTitle}: ${buttonStates.error}`);
          if (buttonStates.expected) {
            console.log(`      期待: ${buttonStates.expected}, 検出: ${JSON.stringify(buttonStates.found)}`);
          }
          // ESCでモーダルを閉じて次へ
          await page.keyboard.press('Escape');
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        // 日付と時間枠のマッピング
        const slotsPerDay = plan.timeSlots.length;
        const disabledSlots = [];

        for (const btn of buttonStates) {
          if (btn.disabled) {
            const col = Math.floor(btn.index / slotsPerDay); // 日付インデックス
            const row = btn.index % slotsPerDay; // 時間枠インデックス
            disabledSlots.push({ col, row });
          }
        }

        // デバッグ: ボタン状態の詳細を出力
        console.log(`    → DOM検出: ${buttonStates.length}個のボタン, ${disabledSlots.length}個がdisabled`);
        if (buttonStates.length <= 10) {
          buttonStates.forEach((btn, i) => {
            console.log(`      [${i}] disabled=${btn.disabled} text="${btn.text}"`);
          });
        }

        // 日付ヘッダーを取得
        const dateInfo = await page.evaluate(() => {
          const dateTexts = [];
          // モーダル内の日付ヘッダーを探す
          const allDivs = document.querySelectorAll('div');
          for (const div of allDivs) {
            const text = div.innerText.trim();
            // 日付パターン: "11\n日" や "12\n月" など
            if (text.match(/^\d{1,2}\n[日月火水木金土]$/)) {
              const day = parseInt(text.split('\n')[0]);
              dateTexts.push(day);
            }
          }
          // 重複を除去して最初の7件を返す
          const unique = [...new Set(dateTexts)].slice(0, 7);
          return unique.length > 0 ? unique : null;
        });

        // 日付リストを構築
        const dates = [];
        if (dateInfo && dateInfo.length > 0) {
          for (const day of dateInfo) {
            dates.push({ day });
          }
        } else {
          // 日付が取得できない場合は今日から7日分
          const today = new Date();
          for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() + i);
            dates.push({ day: d.getDate(), month: d.getMonth() + 1 });
          }
        }

        // 無効スロットのセットを作成（高速ルックアップ用）
        const disabledSet = new Set(disabledSlots.map(s => `${s.col}-${s.row}`));

        // 空きスロットを計算（全スロット - 無効スロット）
        const availableSlots = [];
        const numDays = Math.min(dates.length, 7);

        for (let dayIdx = 0; dayIdx < numDays; dayIdx++) {
          for (let slotIdx = 0; slotIdx < slotsPerDay; slotIdx++) {
            const key = `${dayIdx}-${slotIdx}`;
            if (!disabledSet.has(key)) {
              availableSlots.push({
                day: dates[dayIdx].day,
                month: dates[dayIdx].month,
                timeSlot: plan.timeSlots[slotIdx]
              });
            }
          }
        }

        const availability = { availableSlots };

        // モーダルを閉じる（×ボタンをクリック）
        const modalClosed = await page.evaluate(() => {
          // ×ボタンを探す（モーダル右上）
          const closeButtons = document.querySelectorAll('button');
          for (const btn of closeButtons) {
            if (btn.innerText === '×' || btn.innerText === '✕') {
              btn.click();
              return true;
            }
          }
          // SVGの×アイコンを持つボタン
          const svgCloseBtn = document.querySelector('button svg[stroke="currentColor"]');
          if (svgCloseBtn) {
            svgCloseBtn.closest('button').click();
            return true;
          }
          return false;
        });

        if (!modalClosed) {
          // フォールバック: ESCキー
          await page.keyboard.press('Escape');
        }

        // モーダルがDOMから削除されるまで待機
        await page.waitForFunction((planTitle) => {
          // このプラン名を含むモーダルがなくなるまで待つ
          const elements = document.querySelectorAll('*');
          for (const el of elements) {
            if (el.innerText && el.innerText.includes('日時を選ぶ') && el.innerText.includes(planTitle)) {
              // モーダルがまだ存在する
              const style = window.getComputedStyle(el);
              if (style.display !== 'none' && style.visibility !== 'hidden') {
                return false;
              }
            }
          }
          return true;
        }, { timeout: 5000 }, plan.planTitle).catch(() => {});

        await new Promise(resolve => setTimeout(resolve, 500));

        // 結果を処理
        let addedCount = 0;
        if (availability.availableSlots) {
          for (const slot of availability.availableSlots) {
            let month = slot.month || currentMonth;
            let year = currentYear;

            if (slot.day < now.getDate() - 7) {
              month = currentMonth + 1;
              if (month > 12) {
                month = 1;
                year++;
              }
            }

            let dateStr = `${year}-${String(month).padStart(2, '0')}-${String(slot.day).padStart(2, '0')}`;

            if (plan.isNight) {
              const d = new Date(dateStr);
              d.setDate(d.getDate() - 1);
              dateStr = d.toISOString().split('T')[0];
            }

            if (!result.dates[dateStr]) {
              result.dates[dateStr] = {};
            }
            if (!result.dates[dateStr][plan.name]) {
              result.dates[dateStr][plan.name] = [];
            }
            if (!result.dates[dateStr][plan.name].includes(slot.timeSlot)) {
              result.dates[dateStr][plan.name].push(slot.timeSlot);
              addedCount++;
            }
          }
        }

        console.log(`    → ${plan.planTitle}: 完了 (${addedCount}枠)`);

      } catch (err) {
        console.log(`    → ${plan.planTitle}: エラー - ${err.message}`);
      }
    }

    console.log(`    → 脈: ${Object.keys(result.dates).length}日分のデータ取得`);
    return result;

  } finally {
    await page.close();
  }
}

module.exports = { scrape };
