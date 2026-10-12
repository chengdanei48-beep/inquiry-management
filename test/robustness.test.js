// 不正な入力に対する堅牢性: どのAPIも、不正なパス・クエリ・本文・ヘッダーに対して、
// 500 ではなく 400 / 404 / 409 で返すこと。壊れたHTTPリクエストでも、サーバーが動き続けること。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createApiRoutes } from '../src/api/index.js';
import { withApp } from '../test-support/app.js';

const ID_VALUES = ['1', '2', '999', '0', '-1', '1.5', 'abc', '%ZZ', '%E0%A4%A', '%00', '9'.repeat(40), '%F0%9F%98%80', '..%2F..%2Fx', '1e3'];
const MONTH_VALUES = ['2026-09', '2026-13', '2026-9', '%ZZ', '..%2Fx', '%00'];
const FILE_VALUES = ['a01.csv', 'a01.svg', 'a07.csv', 'meta.json', '%ZZ', '..%2Fmeta.json', 'a01.csv%00.svg'];
const QUERIES = [
  '', '?page=%ZZ', '?page=0', '?page=99999999999999999999', '?status=%ZZ', '?categoryId=-1', '?assigneeId=none',
  '?assigneeId=%00', '?sort=%ZZ&dir=%ZZ', `?q=${'x'.repeat(5000)}`, '?q=%25%5F%5C', '?from=%ZZ&to=%ZZ',
  '?type=%ZZ&from=2026-01-01&to=2026-01-31', '?from=0100-01-01&to=9999-12-31', '?staff=%ZZ', '?active=2',
];
const BODIES = [
  undefined, {}, [], null, 'text', 123, true,
  { title: { a: 1 }, body: [], requesterId: 'x', categoryId: {}, priority: [] },
  { title: 'x'.repeat(100000) },
  { updatedAt: [], status: {}, assigneeId: '1e3', text: 42 },
  { name: null, department: 5, isStaff: 'yes', isActive: 'no', sortOrder: -5 },
  { month: { a: 1 } },
  { relatedInquiryId: 1e30, requesterId: 1e30, categoryId: -0 },
  JSON.parse('{"__proto__": {"polluted": true}, "constructor": "x"}'),
];
const HEADERS = [{}, { 'X-Operator-Id': 'abc' }, { 'X-Operator-Id': '1e3' }, { 'X-Operator-Id': '1' }, { 'X-Operator-Id': '99999999999999999999999' }];

/** パス中の :name を、値の候補で展開する(組み合わせが多いときは間引く)。 */
function expand(pathTemplate) {
  const names = [...pathTemplate.matchAll(/:(\w+)/g)].map((m) => m[1]);
  if (names.length === 0) return [pathTemplate];
  const pools = { id: ID_VALUES, month: MONTH_VALUES, file: FILE_VALUES };
  let combos = [pathTemplate];
  for (const name of names) {
    const next = [];
    for (const c of combos) for (const v of pools[name] ?? ID_VALUES) next.push(c.replace(`:${name}`, v));
    combos = next;
  }
  const step = Math.ceil(combos.length / 60);
  return combos.length > 60 ? combos.filter((_, i) => i % step === 0) : combos;
}

test('堅牢性: 不正なパス・クエリ・本文・ヘッダーでも、どのAPIも 500 を返さない', () => withApp(async (app) => {
  await app.create(); // id 1 が存在する状態
  let requests = 0;
  const bad = [];

  for (const route of createApiRoutes()) {
    const writes = route.method === 'POST' || route.method === 'PATCH';
    for (const url of expand(route.path)) {
      for (const query of writes ? [''] : QUERIES) {
        for (const body of writes ? BODIES : [undefined]) {
          for (const headers of writes ? HEADERS : [{}]) {
            requests += 1;
            const label = `${route.method} ${url}${query}`;
            let res;
            try {
              res = await app.api(route.method, `${url}${query}`, { body, operator: null, headers });
            } catch (err) {
              bad.push(`${label}: 通信エラー ${err.message}`);
              continue;
            }
            if (res.status >= 500) bad.push(`${label} → ${res.status} ${res.text.slice(0, 80)}`);
            // エラー応答は、設計書の形式(JSON)で、内部情報を含まない
            if (res.status >= 400 && res.body !== null && res.headers.get('content-type')?.includes('json')) {
              assert.equal(typeof res.body.error?.code, 'string', label);
              assert.ok(!/SELECT |INSERT |UPDATE |FROM |node:|\.js:\d+/.test(res.text), `内部情報を含む: ${res.text.slice(0, 120)}`);
            }
          }
        }
      }
    }
  }
  assert.ok(requests > 1500, `${requests} 件しか試していない`);
  assert.deepEqual(bad.slice(0, 10), [], `500 になったリクエストが ${bad.length} 件`);
}));

test('堅牢性: 不正なパーセントエンコードの URL は 404(500 にしない)', () => withApp(async (app) => {
  for (const p of ['/api/inquiries/%ZZ', '/api/inquiries/%E0%A4%A', '/api/reports/monthly/%ZZ/a01.csv', '/api/employees/%']) {
    const res = await app.api('GET', p, { operator: null });
    assert.equal(res.status, 404, p);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  }
}));

/** 生のバイト列を送って、応答(または切断)を受け取る。 */
function sendRaw(port, bytes) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let data = '';
    const finish = () => { socket.destroy(); resolve(data); };
    socket.setTimeout(3000, finish);
    socket.on('data', (c) => { data += c.toString('latin1'); });
    socket.on('error', finish);
    socket.on('close', () => resolve(data));
    socket.on('connect', () => { socket.write(bytes); socket.end(); });
  });
}

test('堅牢性: 壊れたHTTPリクエスト・途中で切れたリクエスト・巨大なヘッダーでも、サーバーは動き続ける', () => withApp(async (app) => {
  const host = `Host: localhost:${app.port}\r\n`;
  const attacks = {
    'HTTPとして不正な行': 'これはHTTPではありません\r\n\r\n',
    '未知のメソッド': `FOO /api/inquiries HTTP/1.1\r\n${host}\r\n`,
    '本文の長さを偽る(途中で切断)': `POST /api/inquiries HTTP/1.1\r\n${host}Content-Length: 1000\r\nContent-Type: application/json\r\n\r\n{"title":`,
    '巨大なヘッダー': `GET /api/inquiries HTTP/1.1\r\n${host}X-Big: ${'a'.repeat(100000)}\r\n\r\n`,
    '巨大なURL': `GET /api/inquiries?q=${'a'.repeat(100000)} HTTP/1.1\r\n${host}\r\n`,
    'NULバイトを含むパス': `GET /api/inquiries/%00\u0000 HTTP/1.1\r\n${host}\r\n`,
    'Hostヘッダーが無い': 'GET / HTTP/1.1\r\n\r\n',
  };
  for (const [name, bytes] of Object.entries(attacks)) {
    const response = await sendRaw(app.port, bytes);
    // 応答の内容は問わない(拒否・切断でよい)。内部情報を返さないこと。
    assert.ok(!/node:|\.js:\d+|SELECT /.test(response), `${name}: 内部情報を含む`);
    // 攻撃の後も、通常のリクエストに応答できる
    const ok = await app.api('GET', '/api/inquiries', { operator: null });
    assert.equal(ok.status, 200, `${name} の後に応答できない`);
  }
}));
