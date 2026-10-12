import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { createServer } from '../src/server.js';
import { conflict, validationError } from '../src/http/errors.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

let server;
let base;
let port;
const logs = [];

before(async () => {
  const routes = [
    { method: 'GET', path: '/api/_test/ok', handler: async () => ({ body: { ok: true } }) },
    { method: 'GET', path: '/api/_test/items/:id', handler: async ({ params }) => ({ body: { id: params.id } }) },
    { method: 'POST', path: '/api/_test/echo', handler: async ({ readJson }) => ({ status: 201, body: await readJson() }) },
    { method: 'GET', path: '/api/_test/validation', handler: async () => { throw validationError([{ field: 'title', message: '件名を入力してください' }]); } },
    { method: 'GET', path: '/api/_test/conflict', handler: async () => { throw conflict('STALE_UPDATE', '他の担当者が先に更新しました'); } },
    { method: 'GET', path: '/api/_test/boom', handler: async () => { throw new Error('SELECT * FROM secret_table'); } },
  ];
  server = createServer({
    db: openDatabase(':memory:'),
    config: { publicDir },
    routes,
    log: (line) => logs.push(line),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

// fetch は ../ を正規化してしまうため、生のパスや Host ヘッダーを指定できる http.request を使う
function rawRequest({ path: reqPath, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: reqPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('設定: 既定値は 8080 と localhost、環境変数で上書きできる', () => {
  const def = loadConfig({});
  assert.equal(def.port, 8080);
  assert.equal(def.host, '127.0.0.1');
  assert.ok(def.dbPath.endsWith(path.join('data', 'inquiry.db')));
  const custom = loadConfig({ PORT: '9090', DB_PATH: ':memory:' });
  assert.equal(custom.port, 9090);
  assert.equal(custom.dbPath, ':memory:');
  assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT/);
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT/);
});

test('待ち受け: localhost(127.0.0.1)のみ', () => {
  assert.equal(server.address().address, '127.0.0.1');
});

test('静的ファイル: / で index.html を返し、セキュリティヘッダーが付く', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await res.text(), /<title>問い合わせ管理<\/title>/);
});

test('静的ファイル: 存在しないパスは 404', async () => {
  const res = await fetch(`${base}/no-such-file.js`);
  assert.equal(res.status, 404);
});

test('静的ファイル: publicDir の外は配信しない(パス・トラバーサル)', async () => {
  for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/package.json', '/..%5cpackage.json', '/%00']) {
    const res = await rawRequest({ path: p });
    assert.notEqual(res.status, 200, `${p} が配信された`);
    assert.ok(!res.text.includes('inquiry-management'), `${p} で package.json の内容が返った`);
  }
});

test('静的ファイル: GET・HEAD 以外は 404', async () => {
  const res = await fetch(`${base}/`, { method: 'POST' });
  assert.equal(res.status, 404);
});

test('API: 未定義のパスは 404 NOT_FOUND(JSON)', async () => {
  const res = await fetch(`${base}/api/unknown`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json();
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.equal(typeof body.error.message, 'string');
});

test('API: パスとメソッドが一致するルートだけが呼ばれる', async () => {
  assert.deepEqual(await (await fetch(`${base}/api/_test/ok`)).json(), { ok: true });
  assert.deepEqual(await (await fetch(`${base}/api/_test/items/42`)).json(), { id: '42' });
  const wrongMethod = await fetch(`${base}/api/_test/ok`, { method: 'POST' });
  assert.equal(wrongMethod.status, 404);
});

test('API: JSONボディを読み、201 を返せる', async () => {
  const res = await fetch(`${base}/api/_test/echo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '件名' }),
  });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { title: '件名' });
});

test('API: 不正なJSONは 400 VALIDATION_ERROR', async () => {
  for (const body of ['{not json', '[1,2]', 'null']) {
    const res = await fetch(`${base}/api/_test/echo`, { method: 'POST', body });
    assert.equal(res.status, 400, body);
    assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
  }
});

test('API: 大きすぎるボディは 400', async () => {
  const res = await fetch(`${base}/api/_test/echo`, { method: 'POST', body: JSON.stringify({ x: 'a'.repeat(70 * 1024) }) });
  assert.equal(res.status, 400);
});

test('エラー: 項目ごとのエラーと 409 が設計書の形式で返る', async () => {
  const v = await fetch(`${base}/api/_test/validation`);
  assert.equal(v.status, 400);
  assert.deepEqual((await v.json()).error, {
    code: 'VALIDATION_ERROR', message: '入力内容を確認してください',
    fields: [{ field: 'title', message: '件名を入力してください' }],
  });
  const c = await fetch(`${base}/api/_test/conflict`);
  assert.equal(c.status, 409);
  assert.equal((await c.json()).error.code, 'STALE_UPDATE');
});

test('エラー: 想定外の例外は 500 で、内部情報を返さずログにだけ残す', async () => {
  const res = await fetch(`${base}/api/_test/boom`);
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.equal(JSON.parse(text).error.code, 'INTERNAL_ERROR');
  assert.ok(!text.includes('secret_table'), 'SQLなどの内部情報が応答に含まれている');
  assert.ok(logs.some((l) => l.startsWith('ERROR') && l.includes('secret_table')));
});

test('Hostヘッダー: localhost 以外は拒否される', async () => {
  const ok = await rawRequest({ path: '/', headers: { Host: `localhost:${port}` } });
  assert.equal(ok.status, 200);
  const bad = await rawRequest({ path: '/', headers: { Host: 'evil.example.com' } });
  assert.equal(bad.status, 400);
});

test('ログ: メソッド・パス・結果を出し、リクエストの内容は出さない', async () => {
  logs.length = 0;
  await fetch(`${base}/api/_test/echo`, { method: 'POST', body: JSON.stringify({ title: '秘密の件名' }) });
  assert.ok(logs.some((l) => /^POST \/api\/_test\/echo 201 \d+ms$/.test(l)), logs.join('\n'));
  assert.ok(!logs.join('\n').includes('秘密の件名'));
});
