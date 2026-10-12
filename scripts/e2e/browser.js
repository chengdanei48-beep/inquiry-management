// 実ブラウザ(Chrome)の操作。Chrome DevTools Protocol を、標準の WebSocket で使う(外部依存なし)。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Chrome の実行ファイルを探す。環境変数 CHROME_PATH が優先。見つからなければ null。 */
export function findChrome(env = process.env) {
  const candidates = [
    env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/** 空いているポートを1つ返す(Chrome のデバッグ用。アプリのポートではない)。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Chrome を起動して、1つのページを操作するためのオブジェクトを返す。 */
export async function launchBrowser({ chromePath, width = 1280, height = 900 }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'inquiry-e2e-profile-'));
  const port = await freePort();
  const proc = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: 'ignore' });

  let target;
  for (let i = 0; i < 80 && !target; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* 起動待ち */ }
    if (!target) await sleep(250);
  }
  if (!target) {
    proc.kill();
    throw new Error('Chrome に接続できませんでした');
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let nextId = 1;
  const pending = new Map();
  const events = { console: [], exceptions: [] };
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      events.console.push({ type: msg.params.type, text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
    } else if (msg.method === 'Runtime.exceptionThrown') {
      events.exceptions.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');

  const page = {
    events,
    async goto(url) {
      await send('Page.navigate', { url });
      await sleep(400);
    },
    /** ページ内で式を評価して値を返す(Promise も待つ)。 */
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        throw new Error(`評価に失敗: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n式: ${expression.slice(0, 160)}`);
      }
      return r.result.value;
    },
    /** 条件が真になるまで待つ。 */
    async waitFor(expression, { timeout = 6000, label = expression } = {}) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try { if (await page.eval(expression)) return; } catch { /* 画面の更新中 */ }
        await sleep(60);
      }
      throw new Error(`待機がタイムアウト: ${label}`);
    },
    /** キーを押す(キーボード操作の確認用)。 */
    async press(key) {
      const keys = {
        Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
        Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
        Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
        Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
      };
      const k = keys[key];
      if (!k) throw new Error(`未対応のキー: ${key}`);
      await send('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...k });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode });
      await sleep(40);
    },
    async insertText(text) {
      await send('Input.insertText', { text });
    },
    async screenshot(file) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    },
    async close() {
      try { ws.close(); } catch { /* 無視 */ }
      proc.kill();
      await sleep(300);
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
  return page;
}

/** 画面の操作を短く書くための補助。 */
export function createDsl(page, outDir) {
  const J = JSON.stringify;
  const dsl = {
    page,
    text: (sel) => page.eval(`document.querySelector(${J(sel)})?.textContent ?? null`),
    count: (sel) => page.eval(`document.querySelectorAll(${J(sel)}).length`),
    exists: (sel) => page.eval(`Boolean(document.querySelector(${J(sel)}))`),
    attr: (sel, name) => page.eval(`document.querySelector(${J(sel)})?.getAttribute(${J(name)}) ?? null`),
    value: (sel) => page.eval(`document.querySelector(${J(sel)})?.value ?? null`),
    setValue: (sel, v) => page.eval(`(() => { const el = document.querySelector(${J(sel)}); el.value = ${J(v)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`),
    buttonExists: (label) => page.eval(`[...document.querySelectorAll('button, a.button')].some((b) => b.textContent.trim() === ${J(label)})`),
    clickButton: (label, scope = 'document') => page.eval(`(() => { const b = [...${scope}.querySelectorAll('button, a.button')].find((x) => x.textContent.trim() === ${J(label)}); if (!b) throw new Error('ボタンがありません: ' + ${J(label)}); b.click(); })()`),
    optionValue: (selectSel, label) => page.eval(`[...document.querySelector(${J(selectSel)}).options].find((o) => o.textContent.includes(${J(label)}))?.value ?? null`),
    messageText: () => page.eval(`document.querySelector('#messages')?.textContent ?? ''`),
    goto: (hash) => page.eval(`location.hash = ${J(hash)}`),
    waitHeading: (needle) => page.waitFor(`document.querySelector('#view h2')?.textContent.includes(${J(needle)})`, { label: `見出し「${needle}」` }),
    waitMessage: (needle) => page.waitFor(`document.querySelector('#messages')?.textContent.includes(${J(needle)})`, { label: `メッセージ「${needle}」` }),
    shot: (name) => page.screenshot(path.join(outDir, `${name}.png`)),
    /** 表の各行を、セルの文字列の配列にして返す。 */
    rowsOf: (tableSel) => page.eval(`[...document.querySelectorAll(${J(tableSel)} + ' tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent.trim()))`),
    /** 1列目(または入力欄)が rowText の行にあるボタンを押す。 */
    clickRowButton: (rowText, label) => page.eval(`(() => {
      const tr = [...document.querySelectorAll('#view tbody tr')].find((r) => r.children[0].textContent.trim() === ${J(rowText)} || [...r.querySelectorAll('input')].some((i) => i.value === ${J(rowText)}));
      if (!tr) throw new Error('行がありません: ' + ${J(rowText)});
      const b = [...tr.querySelectorAll('button')].find((x) => x.textContent.trim() === ${J(label)});
      if (!b) throw new Error('ボタンがありません: ' + ${J(label)});
      b.click();
    })()`),
    /** 再読み込みして、新しい画面になるまで待つ。 */
    async reload(readyExpression) {
      await page.eval('window.__beforeReload = true');
      await page.eval('location.reload()');
      await page.waitFor(`window.__beforeReload === undefined && (${readyExpression})`);
    },
    /** コンソールの例外・エラー(想定している 4xx の読み込みエラーは除く)。 */
    consoleErrors: () => [
      ...page.events.exceptions,
      ...page.events.console.filter((c) => c.type === 'error' && !c.text.includes('Failed to load resource')).map((c) => c.text),
    ],
  };
  return dsl;
}
