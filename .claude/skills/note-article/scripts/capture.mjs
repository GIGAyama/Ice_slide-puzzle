/* 実ブラウザでアプリを操作してスクリーンショットを撮るための土台。
 *
 *   node capture.mjs <シナリオファイル> [--base URL] [--out ディレクトリ]
 *
 * シナリオ側は「どのボタンを押して、どこで撮るか」だけを書けばよい。
 * Chromium の場所さがし、ふりがなを落とした文字照合、React の input への
 * 値入れ、複数端末の同時起動といった面倒は、こちらで引きうける。
 *
 * ── なぜこの土台が要るのか
 * この手の撮影で毎回つまずくのは、アプリの機能ではなく次の3つだった。
 *   1. ボタンの文字に <rt>（ふりがな）が混ざっていて、素朴な文字列一致が効かない
 *   2. Chromium の実体の場所が環境ごとに違う
 *   3. React の input は value を直接書きかえても state に伝わらない
 * 毎回書きなおす価値のないところなので、ここに固めてある。
 *
 * ── シナリオの書きかた
 *
 *   // shots.mjs
 *   export const viewport = { width: 390, height: 940 };  // 省略可
 *   export default async ({ open, log }) => {
 *     const p = await open('main');          // 1台ぶんのブラウザを開く
 *     await p.click('スコアアタック');        // 文字でボタンを押す
 *     await p.sleep(800);
 *     await p.click('3年');
 *     await p.shot('03-game');               // 撮る
 *     log(await p.buttons());                // 何が押せるか見たいとき
 *   };
 *
 * 複数端末が要るとき（P2P のマルチプレイなど）は open を何回も呼ぶ。
 * それぞれ独立したブラウザのプロファイルになるので、保存データも混ざらない。
 *
 *   const host = await open('リーダー');
 *   const kids = [];
 *   for (const name of ['たろう', 'はなこ']) kids.push(await open(name));
 */
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

/* playwright は、このスクリプトの隣ではなく「作業中のリポジトリ」に入っている。
 * ふつうに import すると、スキルの置き場所から node_modules をさがしにいって
 * 見つからない。作業ディレクトリを起点に解決しなおす。 */
const chromium = await (async () => {
  try {
    return createRequire(join(process.cwd(), 'x.js'))('playwright').chromium;
  } catch (e) {
    try {
      return (await import('playwright')).chromium;
    } catch (e2) {
      console.error('playwright が見つからない。リポジトリの中で次を実行してから、もう一度。');
      console.error('  npm i --no-save playwright');
      process.exit(2);
    }
  }
})();

// ---------------------------------------------------------------- Chromium さがし
const findChromium = () => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined; // playwright に任せる
  const dirs = readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse();
  for (const dir of dirs) {
    for (const rel of [
      'chrome-linux/chrome',
      'chrome-linux64/chrome',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      'chrome-win/chrome.exe',
    ]) {
      const p = join(root, dir, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
};

// ---------------------------------------------------------------- 引数
const args = process.argv.slice(2);
const FLAGS = ['base', 'out'];
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
// フラグ本体でもフラグの値でもない、最初の引数がシナリオ
const scenarioPath = args.find((a, i) => {
  if (a.startsWith('--')) return false;
  const prev = args[i - 1];
  return !(prev && prev.startsWith('--') && FLAGS.includes(prev.slice(2)));
});
if (!scenarioPath) {
  console.error('使いかた: node capture.mjs <シナリオファイル> [--base URL] [--out ディレクトリ]');
  process.exit(2);
}
const BASE = flag('base', process.env.BASE || 'http://127.0.0.1:4180/');
const OUT = resolve(flag('out', process.env.OUT || './shots'));
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- ページ内で走る道具
// ふりがな（<rt>）とルビ用のかっこ（<rp>）を落としてから文字を比べる。
// 「へやに入る」を探しているのに、DOM 上は「へやに入はいる」になっている、が普通に起きる。
//
// eval の中で const / let を書いても、その外側には漏れない（直接 eval でも同じ）。
// なので「道具の入った箱を返す式」にして、呼ぶ側で受けとる形にしてある。
const IN_PAGE = `(() => {
  const norm = (el) => {
    const c = el.cloneNode(true);
    if (c.querySelectorAll) c.querySelectorAll('rt, rp').forEach((r) => r.remove());
    return ((c.textContent || el.getAttribute('aria-label') || '')).replace(/\\s+/g, '').trim();
  };
  const clickables = () => [...document.querySelectorAll('button, a[href], [role="button"], summary, label, input[type=checkbox], input[type=radio]')]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; });
  const find = (label) => {
    const t = String(label).replace(/\\s+/g, '');
    const c = clickables();
    return c.find((e) => norm(e) === t) || c.find((e) => norm(e).startsWith(t)) || c.find((e) => norm(e).includes(t)) || null;
  };
  return { norm, clickables, find };
})()`;

// ---------------------------------------------------------------- 1台ぶんのラッパ
const wrap = (page, label) => {
  const api = {
    label,
    raw: page,

    /** 文字でボタンを押す。押せたら true。ふりがなは無視して比べる */
    async click(text, { scroll = true } = {}) {
      const ok = await page.evaluate(([src, t, doScroll]) => {
        const { find } = eval(src);
        const el = find(t);
        if (!el) return false;
        if (doScroll) el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      }, [IN_PAGE, text, scroll]);
      if (!ok) console.warn(`[${label}] 押せなかった: ${text}`);
      return ok;
    },

    /** 押す前に、その文字のボタンが出るまで待つ。出なければ false */
    async waitFor(text, timeoutMs = 8000) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const found = await page.evaluate(([src, t]) => !!eval(src).find(t), [IN_PAGE, text]);
        if (found) return true;
        await page.waitForTimeout(300);
      }
      return false;
    },

    /** 押せるものの文字を全部返す。次に何を押せばいいか分からないときに使う */
    buttons() {
      return page.evaluate((src) => {
        const { clickables, norm } = eval(src);
        return clickables().map(norm).filter(Boolean);
      }, IN_PAGE);
    },

    /** 画面の文字。既定は先頭800字 */
    text(limit = 800) {
      return page.evaluate((n) => document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, n), limit);
    },

    /* React の input は el.value = x では state が動かない。
       ネイティブの setter を呼んでから input イベントを投げる必要がある */
    setInput(indexOrSelector, value) {
      return page.evaluate(([sel, v]) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const el = typeof sel === 'number' ? document.querySelectorAll('input')[sel] : document.querySelector(sel);
        if (!el) return false;
        setter.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, [indexOrSelector, value]);
    },

    /** スライダー（input[type=range]）を動かす */
    setRange(value, nth = 0) {
      return page.evaluate(([v, n]) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const el = document.querySelectorAll('input[type=range]')[n];
        if (!el) return false;
        setter.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, [value, nth]);
    },

    /** 目当ての文字が画面に入るまでスクロールする */
    async scrollTo(text) {
      return page.evaluate(([src, t]) => {
        const { find, norm } = eval(src);
        const el = find(t) || [...document.querySelectorAll('h1,h2,h3,h4,p,div')]
          .find((e) => norm(e).includes(String(t).replace(/\s+/g, '')) && e.children.length < 6);
        if (!el) return false;
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        return true;
      }, [IN_PAGE, text]);
    },

    /** 画面の大きさを変える。縦長にすると1枚に収まる画面がある */
    async resize(width, height) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(600);
    },

    sleep: (ms) => page.waitForTimeout(ms),

    async shot(name, { fullPage = false } = {}) {
      const file = join(OUT, `${name}.png`);
      await page.screenshot({ path: file, fullPage });
      console.log(`  撮った  ${name}.png`);
      return file;
    },

    /** ページ内で自由に評価する。凝ったことをしたいとき用の抜け道 */
    eval: (fn, arg) => page.evaluate(fn, arg),
  };
  return api;
};

// ---------------------------------------------------------------- 走らせる
const scenarioUrl = pathToFileURL(isAbsolute(scenarioPath) ? scenarioPath : resolve(scenarioPath)).href;
const scenario = await import(scenarioUrl);
const vp = scenario.viewport || { width: 390, height: 940 };

const browser = await chromium.launch({ executablePath: findChromium() });
const opened = [];

const open = async (label = `page${opened.length + 1}`, opts = {}) => {
  const ctx = await browser.newContext({
    viewport: { width: opts.width || vp.width, height: opts.height || vp.height },
    deviceScaleFactor: opts.deviceScaleFactor ?? 2,   // 2倍で撮ると note で拡大しても粗くならない
    locale: opts.locale || 'ja-JP',
    timezoneId: opts.timezoneId || 'Asia/Tokyo',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${label}] 画面のエラー: ${String(e).slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error') console.error(`[${label}] console: ${m.text().slice(0, 200)}`); });
  await page.goto(opts.url || BASE, { waitUntil: 'networkidle' });
  // 出だしのアニメーションが終わるのを待つ。600ms では足りず、要素を数え落とした過去がある
  await page.waitForTimeout(opts.settleMs ?? 2200);
  const api = wrap(page, label);
  opened.push(api);
  return api;
};

const log = (...a) => console.log(...a);

try {
  await scenario.default({ open, log, base: BASE, out: OUT, pages: opened });
  console.log(`\n出力先: ${OUT}`);
} catch (e) {
  console.error('\nシナリオが落ちた:', e);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}
