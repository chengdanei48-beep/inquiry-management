// AWS へのデプロイ(外部公開)のための、設定・認証・ヘルスチェック・起動の拒否。
// 認証なしで外部に公開しないことを、最優先で確認する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { createServer } from '../src/server.js';
import { createApiRoutes } from '../src/api/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'correct-horse-9';

const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;

async function withServer(configOverrides, fn) {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO employees (name, department, is_staff, is_active) VALUES (?, ?, ?, ?)').run('山田 太郎', '情報システム', 1, 1);
  const logs = [];
  const config = {
    publicDir: path.join(root, 'public'),
    reportsDir: path.join(root, 'data', 'reports-test-unused'),
    ...configOverrides,
  };
  const server = createServer({ db, config, routes: createApiRoutes(), log: (line) => logs.push(line) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const request = (urlPath, { headers = {}, method = 'GET' } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
  try {
    return await fn({ request, logs, port });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
}

const AUTH = { user: 'admin', password: PASSWORD };

// ---- 設定 ----

test('設定(deploy): 既定は localhost のみ・認証なし', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.auth, null);
  assert.deepEqual(config.allowedHosts, []);
});

test('設定(deploy): 認証なしで、localhost 以外では待ち受けられない(0.0.0.0・IPアドレス)', () => {
  for (const host of ['0.0.0.0', '10.0.0.5', '::']) {
    assert.throws(() => loadConfig({ HOST: host }), /APP_PASSWORD/, host);
    assert.throws(() => loadConfig({ HOST: host, APP_PASSWORD: '' }), /APP_PASSWORD/, host);
  }
});

test('設定(deploy): パスワードがあれば、外部に待ち受けられる。ユーザー名の既定は admin', () => {
  const config = loadConfig({ HOST: '0.0.0.0', APP_PASSWORD: PASSWORD, ALLOWED_HOSTS: ' Example.com , * ' });
  assert.equal(config.host, '0.0.0.0');
  assert.deepEqual(config.auth, { user: 'admin', password: PASSWORD });
  assert.deepEqual(config.allowedHosts, ['example.com', '*']);
  assert.equal(loadConfig({ HOST: '0.0.0.0', APP_PASSWORD: PASSWORD, APP_USER: 'staff' }).auth.user, 'staff');
});

test('設定(deploy): localhost でも、パスワードを指定すれば、認証する', () => {
  assert.deepEqual(loadConfig({ APP_PASSWORD: PASSWORD }).auth, { user: 'admin', password: PASSWORD });
});

test('設定(deploy): 短いパスワード・不正な HOST・ユーザー名の ":" は、エラー', () => {
  assert.throws(() => loadConfig({ APP_PASSWORD: 'short' }), /12 文字以上/);
  assert.throws(() => loadConfig({ HOST: 'not a host', APP_PASSWORD: PASSWORD }), /HOST/);
  assert.throws(() => loadConfig({ APP_PASSWORD: PASSWORD, APP_USER: 'a:b' }), /APP_USER/);
});

// ---- 認証 ----

test('認証(deploy): 認証情報が無いと、画面も API も 401 で、WWW-Authenticate を返す', async () => {
  await withServer({ auth: AUTH }, async ({ request }) => {
    for (const urlPath of ['/', '/index.html', '/api/employees', '/js/app.js', '/api/inquiries/export.csv']) {
      const res = await request(urlPath);
      assert.equal(res.status, 401, urlPath);
      assert.match(res.headers['www-authenticate'], /^Basic realm=/, urlPath);
      assert.ok(!res.text.includes('山田'), 'データを返していない');
    }
  });
});

test('認証(deploy): 正しい認証情報なら、画面も API も使える', async () => {
  await withServer({ auth: AUTH }, async ({ request }) => {
    const headers = { Authorization: basic('admin', PASSWORD) };
    assert.equal((await request('/', { headers })).status, 200);
    const api = await request('/api/employees', { headers });
    assert.equal(api.status, 200);
    assert.match(api.text, /山田 太郎/);
  });
});

test('認証(deploy): パスワード違い・ユーザー名違い・形式の誤りは、401', async () => {
  await withServer({ auth: AUTH }, async ({ request }) => {
    const bad = [
      basic('admin', 'wrong-password'),
      basic('root', PASSWORD),
      basic('admin', `${PASSWORD} `),
      basic('admin', PASSWORD.toUpperCase()),
      `Bearer ${PASSWORD}`,
      'Basic',
      'Basic !!!not-base64!!!',
      basic('', ''),
    ];
    for (const header of bad) {
      const res = await request('/api/employees', { headers: { Authorization: header } });
      assert.equal(res.status, 401, header);
    }
  });
});

test('認証(deploy): 日本語を含むパスワードも、使える', async () => {
  await withServer({ auth: { user: 'admin', password: 'ぱすわーど・ぱすわーど12345' } }, async ({ request }) => {
    assert.equal((await request('/', { headers: { Authorization: basic('admin', 'ぱすわーど・ぱすわーど12345') } })).status, 200);
    assert.equal((await request('/', { headers: { Authorization: basic('admin', 'ぱすわーど・ぱすわーど1234') } })).status, 401);
  });
});

test('認証(deploy): 認証の設定が無いとき(localhost のみ)は、認証しない(従来どおり)', async () => {
  await withServer({ auth: null }, async ({ request }) => {
    assert.equal((await request('/api/employees')).status, 200);
  });
});

test('認証(deploy): パスワードは、ログに出ない', async () => {
  await withServer({ auth: AUTH }, async ({ request, logs }) => {
    await request('/api/employees', { headers: { Authorization: basic('admin', PASSWORD) } });
    await request('/api/employees', { headers: { Authorization: basic('admin', 'wrong-password') } });
    const all = logs.join('\n');
    assert.ok(!all.includes(PASSWORD) && !all.includes('wrong-password'));
    assert.ok(!all.includes(Buffer.from(`admin:${PASSWORD}`).toString('base64')));
  });
});

// ---- ヘルスチェック ----

test('ヘルスチェック(deploy): /healthz は、認証なしで 200。内容は固定で、データを含まない', async () => {
  await withServer({ auth: AUTH }, async ({ request }) => {
    const res = await request('/healthz');
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.text), { status: 'ok' });
    assert.equal((await request('/healthz', { method: 'HEAD' })).status, 200);
    // /healthz 以外(似たパス)は、認証が要る
    assert.equal((await request('/healthz/x')).status, 401);
    assert.equal((await request('/healthz', { method: 'POST' })).status, 401);
  });
});

// ---- Host ----

test('Host(deploy): 既定では、localhost 以外の Host は 400', async () => {
  await withServer({}, async ({ request, port }) => {
    assert.equal((await request('/', { headers: { Host: 'example.com' } })).status, 400);
    assert.equal((await request('/', { headers: { Host: `localhost:${port}` } })).status, 200);
  });
});

test('Host(deploy): ALLOWED_HOSTS に指定した名前だけ受け付ける(大文字・小文字は区別しない)。* は全て', async () => {
  await withServer({ allowedHosts: ['app.example.com'] }, async ({ request }) => {
    assert.equal((await request('/', { headers: { Host: 'app.example.com:8080' } })).status, 200);
    assert.equal((await request('/', { headers: { Host: 'APP.Example.com' } })).status, 200);
    assert.equal((await request('/', { headers: { Host: 'evil.example.net' } })).status, 400);
  });
  await withServer({ allowedHosts: ['*'] }, async ({ request }) => {
    assert.equal((await request('/', { headers: { Host: '203.0.113.10' } })).status, 200);
  });
});

test('Host(deploy): Host の検査が、認証より先に行われる(許可されない Host には、401 でなく 400)', async () => {
  await withServer({ auth: AUTH }, async ({ request }) => {
    assert.equal((await request('/', { headers: { Host: 'evil.example.net' } })).status, 400);
  });
});

// ---- 起動 ----

function startMain(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'src', 'main.js')], {
      env: { ...process.env, PORT: '0', DB_PATH: ':memory:', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; if (stdout.includes('起動しました')) child.kill(); });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    setTimeout(() => child.kill(), 10000);
  });
}

test('起動(deploy): 認証なしで HOST=0.0.0.0 を指定すると、起動せず、理由を表示して終了コード 1', async () => {
  const result = await startMain({ HOST: '0.0.0.0', APP_PASSWORD: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /APP_PASSWORD/);
  assert.ok(!result.stdout.includes('起動しました'));
  assert.ok(!result.stderr.includes('    at '), 'スタックトレースを出さない');
});

test('起動(deploy): パスワードがあれば、HOST=0.0.0.0 で起動し、認証ありと表示する(パスワードは表示しない)', async () => {
  const result = await startMain({ HOST: '0.0.0.0', APP_PASSWORD: PASSWORD });
  assert.match(result.stdout, /起動しました/);
  assert.match(result.stdout, /認証あり/);
  assert.ok(!result.stdout.includes(PASSWORD));
});
