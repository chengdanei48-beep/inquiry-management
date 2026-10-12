// 設計書・課金ルールと実装の整合(quality-review「docs ⇔ 実装の差異」「課金ルール」)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiRoutes } from '../src/api/index.js';
import { findChrome } from '../scripts/e2e/browser.js';
import { startTestApp } from '../test-support/app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');

function walk(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full, ext);
    return full.endsWith(ext) ? [full] : [];
  });
}

test('設計書: エンドポイント一覧(api-design.md 4章)と、実装のルートが一致する', () => {
  const doc = read('docs', 'api-design.md');
  const section = doc.slice(doc.indexOf('## 4. エンドポイント一覧'), doc.indexOf('## 5. 主要APIの詳細'));
  const documented = [...section.matchAll(/^\|[^|]*\|\s*(GET|POST|PATCH|DELETE)\s*\|\s*`([^`]+)`/gm)]
    .map((m) => `${m[1]} ${m[2].replace(/\{(\w+)\}/g, ':$1')}`)
    .sort();
  const implemented = createApiRoutes().map((r) => `${r.method} ${r.path}`).sort();
  assert.ok(documented.length >= 19, `設計書から ${documented.length} 件しか読み取れなかった`);
  assert.deepEqual(implemented, documented);
});

test('設計書: エラーコード(api-design.md 3章)と、実装で使うコードが一致する', () => {
  const doc = read('docs', 'api-design.md');
  const section = doc.slice(doc.indexOf('### エラーコードと画面での表示') >= 0 ? doc.indexOf('| code | HTTP |') : 0, doc.indexOf('## 4. エンドポイント一覧'));
  const documented = new Set([...section.matchAll(/^\|\s*`([A-Z_]+)`\s*\|\s*\d{3}\s*\|/gm)].map((m) => m[1]));
  const used = new Set();
  for (const file of walk(path.join(root, 'src'), '.js')) {
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(/(?:conflict\(\s*|AppError\(\s*\d+,\s*)'([A-Z_]+)'/g)) used.add(m[1]);
  }
  assert.ok(documented.size >= 9, `設計書から ${documented.size} 件しか読み取れなかった`);
  assert.deepEqual([...used].sort(), [...documented].sort());
});

test('設計書: 画面設計書 2.3 のメッセージが、画面またはサーバーのコードにある', () => {
  const doc = read('docs', 'screen-design.md');
  const section = doc.slice(doc.indexOf('### 2.3 メッセージ'), doc.indexOf('### 2.4'));
  const messages = [...section.matchAll(/^\|[^|]+\|\s*「([^」]+)」/gm)]
    .map((m) => m[1])
    .filter((m) => !m.includes('{'));
  assert.ok(messages.length >= 8, `${messages.length} 件しか読み取れなかった`);
  const sources = [...walk(path.join(root, 'src'), '.js'), ...walk(path.join(root, 'public', 'js'), '.js')]
    .map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const missing = messages.filter((m) => !sources.includes(m));
  assert.deepEqual(missing, [], `実装に無いメッセージ: ${missing.join(' / ')}`);
});

test('課金ルール: 依存パッケージが無く、Node.js v24 以降を要求している', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.equal(pkg[key], undefined, `${key} がある`);
  }
  assert.match(pkg.engines.node, />=\s*24/);
  assert.equal(pkg.private, true);
  // npm のスクリプトが、要件のとおり揃っている
  for (const name of ['start', 'test', 'seed', 'e2e']) assert.ok(pkg.scripts[name], `scripts.${name} が無い`);
});

test('課金ルール: 外部サービス・SDK・クラウドの利用が、コードに無い', () => {
  // import 文・require・動的 import の取り込み先が、Node.js 標準(node:)か、このリポジトリ内の相対パスだけであること
  const specifiers = (source) => [
    ...source.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm),
    ...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((m) => m[1]);
  const files = [
    ...walk(path.join(root, 'src'), '.js'),
    ...walk(path.join(root, 'scripts'), '.js'),
    ...walk(path.join(root, 'public', 'js'), '.js'),
  ];
  let checked = 0;
  for (const file of files) {
    for (const spec of specifiers(fs.readFileSync(file, 'utf8'))) {
      checked += 1;
      assert.ok(spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../'),
        `${path.relative(root, file)} が外部のモジュール「${spec}」を取り込んでいる`);
    }
  }
  assert.ok(checked > 30, `取り込みを ${checked} 件しか確認できなかった`);
  // 外部サービスの名前が、コードに無い(コメントを除く)
  const services = /aws-sdk|firebase|googleapis|stripe|openai|api\.anthropic|\.amazonaws\.com|cloudflare|azure/i;
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!services.test(code), `${path.relative(root, file)} が外部サービスを参照している`);
  }
});

test('データ保護: DBファイルと実行時データを Git に含めない設定', () => {
  const ignore = read('.gitignore');
  for (const pattern of ['data/', '*.db', 'node_modules/', '.env', 'e2e-output/']) {
    assert.ok(ignore.split('\n').some((l) => l.trim() === pattern), `.gitignore に ${pattern} が無い`);
  }
});

test('公開範囲: localhost 以外のアドレスからは、接続できない', async (t) => {
  const app = await startTestApp();
  try {
    // このアプリの待ち受けポートを調べるため、サーバーを直接起動し直す
    const { createServer } = await import('../src/server.js');
    const { createApiRoutes: routes } = await import('../src/api/index.js');
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig({ PORT: '0', DB_PATH: ':memory:' });
    const server = createServer({ db: app.db, config, routes: routes(), log: () => {} });
    await new Promise((resolve) => server.listen(0, config.host, resolve));
    const { port, address } = server.address();
    try {
      assert.equal(address, '127.0.0.1');
      // 自分のマシンの、loopback 以外のアドレス(LANなど)
      const external = Object.values(os.networkInterfaces()).flat()
        .find((i) => i && i.family === 'IPv4' && !i.internal);
      if (!external) {
        t.skip('loopback 以外のアドレスが無い環境のため、実際の接続の確認は省略');
        return;
      }
      const error = await new Promise((resolve) => {
        const socket = net.connect({ host: external.address, port, timeout: 2000 });
        socket.once('connect', () => { socket.destroy(); resolve(null); });
        socket.once('timeout', () => { socket.destroy(); resolve(new Error('timeout')); });
        socket.once('error', resolve);
      });
      assert.ok(error, `${external.address}:${port} に接続できてしまった`);
      t.diagnostic(`${external.address}:${port} への接続: ${error.code ?? error.message}`);
      // localhost からは接続できる
      const ok = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(ok.status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await app.close();
  }
});

test('実ブラウザ確認: Chrome の探索(CHROME_PATH を優先し、見つからなければ null)', () => {
  assert.equal(findChrome({ CHROME_PATH: process.execPath }), process.execPath);
  const none = findChrome({ CHROME_PATH: path.join(os.tmpdir(), 'no-such-chrome.exe'), LOCALAPPDATA: undefined });
  assert.ok(none === null || typeof none === 'string');
});
