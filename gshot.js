#!/usr/bin/env node
const { chromium, devices } = require('playwright');
const path = require('path');

// ==========================================
// ユーティリティ関数
// ==========================================
function getDateString() {
  const now = new Date();
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const DD = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const mmm = String(now.getMilliseconds()).padStart(3, '0');
  return `${YYYY}-${MM}-${DD}_${hh}-${mm}-${ss}.${mmm}`;
}

function url2filename(url) {
  return url.replace(/[\/:?#&=~]/g, '_');
}

// ==========================================
// スクリーンショット撮影クラス
// ==========================================
class GetScreenshot {
  constructor() {
    this._browser = null;
  }

  async init() {
    // Playwright で Chromium を起動
    this._browser = await chromium.launch({
      headless: true,
      args: ['--window-position=0,0']
    });
  }

  async autoScroll(page) {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const MAX_HEIGHT = 16384;

        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight || totalHeight >= MAX_HEIGHT) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
  }

  async cap({ url, username, password, isSP }) {
    const MAX_HEIGHT = 16384;
    const result = { url, status: null, error: null, imgPath: null };

    if (!this._browser) {
      result.error = 'ブラウザが初期化されていません。';
      return result;
    }

    // 1. コンテキスト（ブラウザのセッション）の設定
    let contextOptions = {};

    // デバイス設定（Playwrightのプリセットを使用）
    if (isSP) {
      contextOptions = { ...devices['iPhone 13'] };
    } else {
      contextOptions = { viewport: { width: 1600, height: 950 } };
    }

    // Basic認証設定
    if (username && password) {
      contextOptions.httpCredentials = { username, password };
    }

    const context = await this._browser.newContext(contextOptions);
    const page = await context.newPage();

    try {
      // 2. イベントリスナー設定
      page.on('response', res => {
        const request_url = url.replace(/#.*$/, '');
        if (res.url() === request_url) {
          result.status = res.status();
        }
      });

      page.on('dialog', dialog => dialog.dismiss());

      // 3. ページへアクセス (waitUntil は Playwright では networkidle になります)
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 })
        .catch((e) => {
          console.log(`アクセス時のタイムアウト (${e.name}): 描画されている可能性があるので続行します`);
        });

      if (response) {
        result.status = response.status();
      } else if (!result.status) {
        result.status = 200; 
      }

      if (result.status >= 400) {
        result.error = `HTTP Status ${result.status}`;
        return result;
      }

      // 4. ページ全体のスクロール
      await this.autoScroll(page);

      // 5. ビューポートの再調整
      const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
      const targetHeight = Math.min(bodyHeight, isSP ? MAX_HEIGHT / 2 : MAX_HEIGHT);
      
      await page.setViewportSize({ 
        width: isSP ? 390 : 1600, 
        height: targetHeight 
      });
      await page.evaluate(() => window.scrollTo(0, 0));

      // スクロール後、レイアウトが安定するまで少し待機
      await new Promise(r => setTimeout(r, 1000));

      // 6. スクリーンショット撮影
      const filename = `${url2filename(url)}_${getDateString()}`;
      const imgPath = path.resolve(`${filename}.png`);
      result.imgPath = imgPath;

      await page.screenshot({ path: imgPath, timeout: 5000 })
        .catch((e) => {
            result.error = `スクリーンショット失敗: ${e.message}`;
        });

    } catch (error) {
      result.error = `キャプチャ中にエラーが発生しました: ${error.message}`;
    } finally {
      await page.close();
      await context.close();
    }

    return result;
  }

  async close() {
    if (this._browser) {
      await this._browser.close();
    }
  }
}

// ==========================================
// メイン処理 (エントリーポイント)
// ==========================================
(async () => {
  const url = process.argv[2];
  const device = process.argv[3] || 'PC'; 
  const username = process.argv[4] || ''; 
  const password = process.argv[5] || ''; 

  if (!url) {
    console.error('【エラー】URLが指定されていません。');
    console.error('使い方: chaptte <URL> [SP/PC] [Basicユーザー名] [Basicパスワード]');
    process.exit(1);
  }

  const isSP = (device.toUpperCase() === 'SP');

  console.log('=== 処理開始 ===');
  console.log(`対象URL: ${url}`);
  console.log(`デバイス: ${isSP ? 'スマートフォン' : 'PC'}`);

  const screenshotter = new GetScreenshot();

  try {
    await screenshotter.init();
    
    console.log('\n--- スクリーンショット撮影中 ---');
    const result = await screenshotter.cap({ url, username, password, isSP });

    if (result.error) {
      console.error('【エラー】スクリーンショットに失敗しました:', result.error);
    } else {
      console.log('撮影完了！');
      console.log('保存先パス:', result.imgPath);
    }

  } catch (error) {
    console.error('【予期せぬエラー】処理中にエラーが発生しました:', error);
  } finally {
    await screenshotter.close();
    console.log('\n=== 処理終了 ===');
  }
})();