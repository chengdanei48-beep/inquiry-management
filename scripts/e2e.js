// 実際の Chrome で、画面の操作を自動確認する(npm run e2e)。
//
// - アプリの既定ポート(8080)で、一時ディレクトリのDBを使うサーバーを起動して確認する。
//   8080 が使用中のときは、別のポートに逃げず、使用中のプロセスを停止するよう案内して終了する(終了コード 2)。
//   このスクリプトは、他のプロセスを停止しない。
// - Chrome が見つからないときは、案内して終了する(終了コード 0)。CHROME_PATH で指定できる。
// - スクリーンショットは e2e-output/ に保存する(Git には含めない)。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDsl, findChrome, launchBrowser, sleep } from './e2e/browser.js';
import { SUITES } from './e2e/suites.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8080;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = path.join(ROOT, 'e2e-output');

function portIsFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* 起動待ち */ }
    await sleep(150);
  }
  throw new Error('サーバーが起動しませんでした');
}

async function waitForPortFree(port, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await portIsFree(port)) return;
    await sleep(100);
  }
}

const chromePath = findChrome();
if (!chromePath) {
  console.log('Chrome が見つからないため、実ブラウザでの確認をスキップしました。');
  console.log('Chrome をインストールするか、環境変数 CHROME_PATH に chrome の実行ファイルを指定してください。');
  process.exit(0);
}

if (!(await portIsFree(PORT))) {
  console.error(`ポート ${PORT} は使用中です。別のポートでは実行しません。`);
  console.error('このポートを使っているプロセスを停止してから、もう一度実行してください。');
  console.error('(PowerShell: Get-NetTCPConnection -LocalPort 8080 -State Listen で、プロセスを確認できます)');
  process.exit(2);
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const totals = { passed: 0, failed: 0 };

for (const suite of SUITES) {
  console.log(`\n■ ${suite.name}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'inquiry-e2e-'));
  const env = { ...process.env, DB_PATH: path.join(work, 'inquiry.db') };
  delete env.PORT; // 既定ポート(8080)で起動する
  let server;
  let browser;
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: Boolean(ok) });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → ${detail}`}`);
  };

  try {
    if (suite.seed) {
      const seeded = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'seed.js')], { env, cwd: ROOT, encoding: 'utf8' });
      if (seeded.status !== 0) throw new Error(`サンプルデータの投入に失敗: ${seeded.stderr}`);
    }
    server = spawn(process.execPath, [path.join(ROOT, 'src', 'main.js')], { env, cwd: ROOT, stdio: 'ignore' });
    await waitForServer(`${BASE_URL}/`);

    browser = await launchBrowser({ chromePath });
    const d = createDsl(browser, OUT_DIR);
    await suite.run({ d, check, baseUrl: BASE_URL });
  } catch (err) {
    check('スクリプトの実行', false, err.message);
    if (browser) {
      try { await browser.screenshot(path.join(OUT_DIR, `failure-${SUITES.indexOf(suite) + 1}.png`)); } catch { /* 無視 */ }
    }
  } finally {
    if (browser) await browser.close();
    if (server) {
      server.kill();
      await waitForPortFree(PORT);
    }
    fs.rmSync(work, { recursive: true, force: true });
  }

  totals.passed += results.filter((r) => r.ok).length;
  totals.failed += results.filter((r) => !r.ok).length;
}

console.log(`\n結果: ${totals.passed}/${totals.passed + totals.failed} 成功(スクリーンショット: ${path.relative(ROOT, OUT_DIR)}/)`);
process.exit(totals.failed === 0 ? 0 : 1);
