// 画面の純粋なロジック(DOMを使わない部分)のテスト。DOMの動作は、実際のブラウザで確認する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, buildQuery, createApi, NETWORK_ERROR_MESSAGE, SERVER_ERROR_MESSAGE } from '../public/js/api.js';
import { formatDate, formatDateTime } from '../public/js/format.js';
import { DEFAULT_LIST_QUERY, nextSort, parseListQuery, toApiQuery, toSearch } from '../public/js/list-query.js';
import { describeError, fieldErrors } from '../public/js/messages.js';
import { createOperatorStore } from '../public/js/operator.js';
import { menuOf, parseRoute } from '../public/js/route.js';
import * as clientStatus from '../public/js/status.js';
import { parseOptionalId, textLength, validateChoice, validateText } from '../public/js/validation.js';
import * as serverStatus from '../src/domain/status.js';
import { parseInquiryCreate } from '../src/domain/validation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- ルーティング ----------

test('ルート: ハッシュから画面を決める', () => {
  assert.deepEqual(parseRoute(''), { name: 'list', search: '' });
  assert.deepEqual(parseRoute('#/inquiries'), { name: 'list', search: '' });
  assert.deepEqual(parseRoute('#/inquiries?status=%E5%AE%8C%E4%BA%86&page=2'), { name: 'list', search: 'status=%E5%AE%8C%E4%BA%86&page=2' });
  assert.deepEqual(parseRoute('#/inquiries/new'), { name: 'new', search: '' });
  assert.deepEqual(parseRoute('#/inquiries/12'), { name: 'detail', id: 12, search: '' });
  assert.equal(parseRoute('#/reports').name, 'reports');
  assert.equal(parseRoute('#/masters').name, 'masters');
});

test('ルート: 不正なIDや未定義のパスは notfound', () => {
  for (const hash of ['#/inquiries/0', '#/inquiries/abc', '#/inquiries/-1', '#/inquiries/1/x', '#/unknown', '#/inquiries/012']) {
    assert.equal(parseRoute(hash).name, 'notfound', hash);
  }
});

test('ルート: 詳細画面ではメニューの「一覧」を強調する', () => {
  assert.equal(menuOf(parseRoute('#/inquiries/5')), 'list');
  assert.equal(menuOf(parseRoute('#/inquiries/new')), 'new');
});

// ---------- 検索条件 ----------

test('検索条件: 既定値は空のクエリになり、既定と違う項目だけが URL に残る', () => {
  assert.equal(toSearch(DEFAULT_LIST_QUERY), '');
  assert.equal(toSearch({ ...DEFAULT_LIST_QUERY, status: '完了', page: 2 }), 'status=%E5%AE%8C%E4%BA%86&page=2');
  assert.equal(toSearch({ ...DEFAULT_LIST_QUERY, sort: 'priority', dir: 'asc' }), 'sort=priority&dir=asc');
});

test('検索条件: URL との往復で値が変わらない(日本語・記号を含む)', () => {
  const q = { ...DEFAULT_LIST_QUERY, status: '保留', categoryId: '3', assigneeId: 'none', dept: '情報システム', q: '100%&_ x', sort: 'priority', dir: 'asc', page: 3 };
  assert.deepEqual(parseListQuery(toSearch(q)), q);
});

test('検索条件: 不正な値は既定値に戻る(任意の入力で例外にならない)', () => {
  const q = parseListQuery('status=削除&categoryId=abc&assigneeId=x&sort=title&dir=up&page=0&dept=' + 'あ'.repeat(80));
  assert.equal(q.status, '');
  assert.equal(q.categoryId, '');
  assert.equal(q.assigneeId, '');
  assert.equal(q.sort, 'received');
  assert.equal(q.dir, 'desc');
  assert.equal(q.page, 1);
  assert.equal(q.dept.length, 50);
  assert.deepEqual(parseListQuery('?page=-5&page=abc'), DEFAULT_LIST_QUERY);
});

test('検索条件: APIに渡す形(CSVはページを付けない)', () => {
  const q = { ...DEFAULT_LIST_QUERY, status: '完了', page: 4 };
  assert.equal(toApiQuery(q).page, 4);
  assert.equal('page' in toApiQuery(q, { withPage: false }), false);
  assert.equal(buildQuery(toApiQuery(q, { withPage: false })), '?status=%E5%AE%8C%E4%BA%86&sort=received&dir=desc');
});

test('検索条件: 並び替えの切り替え(優先度は高→低から、受付日時は新しい順から)', () => {
  assert.deepEqual(nextSort(DEFAULT_LIST_QUERY, 'priority'), { sort: 'priority', dir: 'asc' });
  assert.deepEqual(nextSort({ ...DEFAULT_LIST_QUERY, sort: 'priority', dir: 'asc' }, 'priority'), { sort: 'priority', dir: 'desc' });
  assert.deepEqual(nextSort(DEFAULT_LIST_QUERY, 'received'), { sort: 'received', dir: 'asc' });
  assert.deepEqual(nextSort({ ...DEFAULT_LIST_QUERY, sort: 'priority', dir: 'desc' }, 'received'), { sort: 'received', dir: 'desc' });
});

// ---------- APIクライアント ----------

/** 応答を返す偽の fetch。呼び出しを記録する。 */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  fn.calls = calls;
  return fn;
}
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });

test('API: GET はクエリを付け、操作者を送らない', async () => {
  const f = fakeFetch(() => jsonResponse(200, { items: [] }));
  const api = createApi({ fetchFn: f, getOperatorId: () => 3 });
  await api.listInquiries({ status: '完了', q: '', page: 2 });
  assert.equal(f.calls[0].url, '/api/inquiries?status=%E5%AE%8C%E4%BA%86&page=2');
  assert.equal(f.calls[0].init.method, 'GET');
  assert.equal(f.calls[0].init.headers['X-Operator-Id'], undefined);
});

test('API: 変更系は、操作する担当者(X-Operator-Id)とJSONボディを送る', async () => {
  const f = fakeFetch(() => jsonResponse(201, { id: 1 }));
  const api = createApi({ fetchFn: f, getOperatorId: () => 3 });
  await api.createInquiry({ title: '件名' });
  const { init } = f.calls[0];
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['X-Operator-Id'], '3');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.body, JSON.stringify({ title: '件名' }));
});

test('API: 操作者が未選択なら X-Operator-Id を付けない', async () => {
  const f = fakeFetch(() => jsonResponse(200, {}));
  const api = createApi({ fetchFn: f, getOperatorId: () => null });
  await api.changeStatus(1, { status: '対応中', updatedAt: 'x' });
  assert.equal(f.calls[0].init.headers['X-Operator-Id'], undefined);
});

test('API: サーバーのエラーを ApiError にする(コード・文言・項目)', async () => {
  const body = { error: { code: 'VALIDATION_ERROR', message: '入力内容を確認してください', fields: [{ field: 'title', message: '件名を入力してください' }] } };
  const api = createApi({ fetchFn: fakeFetch(() => jsonResponse(400, body)) });
  await assert.rejects(() => api.createInquiry({}), (e) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 400);
    assert.equal(e.code, 'VALIDATION_ERROR');
    assert.equal(e.isValidation, true);
    assert.deepEqual(fieldErrors(e), { title: '件名を入力してください' });
    return true;
  });
});

test('API: 通信の失敗は NETWORK(ステータス 0)にする', async () => {
  const api = createApi({ fetchFn: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(() => api.listInquiries(), (e) => {
    assert.equal(e.code, 'NETWORK');
    assert.equal(e.status, 0);
    assert.equal(e.isNetwork, true);
    assert.equal(e.message, NETWORK_ERROR_MESSAGE);
    return true;
  });
});

test('API: JSONでない応答・本文なしのエラーでも、内部情報を出さずに ApiError にする', async () => {
  const html = { ok: false, status: 502, text: async () => '<html>Bad Gateway at 10.0.0.1</html>' };
  await assert.rejects(() => createApi({ fetchFn: async () => html }).listInquiries(), (e) => {
    assert.equal(e.status, 502);
    assert.equal(e.message, SERVER_ERROR_MESSAGE);
    assert.ok(!e.message.includes('10.0.0.1'));
    return true;
  });
  const empty = { ok: false, status: 500, text: async () => '' };
  await assert.rejects(() => createApi({ fetchFn: async () => empty }).listInquiries(), (e) => e.message === SERVER_ERROR_MESSAGE);
});

test('API: パスにIDが入り、CSVのURLが作られる', () => {
  const f = fakeFetch(() => jsonResponse(200, {}));
  const api = createApi({ fetchFn: f });
  assert.equal(api.inquiriesCsvUrl({ status: '完了' }), '/api/inquiries/export.csv?status=%E5%AE%8C%E4%BA%86');
  assert.equal(api.inquiriesCsvUrl({}), '/api/inquiries/export.csv');
});

// ---------- メッセージ ----------

test('メッセージ: 通信失敗・サーバーエラー・404・409 を利用者向けの文言にする', () => {
  const e = (status, code, message) => new ApiError({ status, code, message });
  assert.equal(describeError(e(0, 'NETWORK', 'x')), NETWORK_ERROR_MESSAGE);
  assert.equal(describeError(e(500, 'INTERNAL_ERROR', 'SELECT * FROM')), SERVER_ERROR_MESSAGE);
  assert.equal(describeError(e(404, 'NOT_FOUND', '見つかりません'), { notFound: '問い合わせが見つかりません' }), '問い合わせが見つかりません');
  assert.equal(
    describeError(e(409, 'STALE_UPDATE', '他の担当者が先に更新しました。最新の内容を読み込み直してください')),
    '他の担当者が先に更新しました。最新の内容を読み込み直してください',
  );
  assert.equal(describeError(new Error('boom: /home/user/secret')), SERVER_ERROR_MESSAGE);
  assert.equal(describeError('文字列'), SERVER_ERROR_MESSAGE);
});

// ---------- 検証(サーバーと同じ規則) ----------

test('検証: 50文字は通り、51文字・空白のみは拒否される(サーバーと同じ文言)', () => {
  assert.deepEqual(validateText('件名', ' あ '), { value: 'あ', error: '' });
  assert.equal(validateText('件名', 'あ'.repeat(50)).error, '');
  assert.equal(validateText('件名', 'あ'.repeat(51)).error, '件名は50文字以内で入力してください');
  assert.equal(validateText('件名', '   ').error, '件名を入力してください');
  assert.equal(validateText('件名', undefined).error, '件名を入力してください');
  assert.equal(validateText('任意', '', { required: false }).error, '');
  assert.equal(validateText('件名', '😀'.repeat(50)).error, ''); // 絵文字は1文字
  assert.equal(textLength('😀😀'), 2);
});

test('検証: 画面の検証とサーバーの検証が、同じ入力に対して同じ結論になる', () => {
  const samples = ['', '  ', 'あ', 'あ'.repeat(50), 'あ'.repeat(51), '😀'.repeat(50), '😀'.repeat(51), ' ' + 'a'.repeat(50) + ' '];
  for (const s of samples) {
    const clientOk = validateText('件名', s).error === '';
    let serverOk = true;
    try {
      parseInquiryCreate({ title: s, body: 'x', requesterId: 1, categoryId: 1, priority: '中' });
    } catch {
      serverOk = false;
    }
    assert.equal(clientOk, serverOk, JSON.stringify(s));
  }
});

test('検証: 選択肢・関連するID', () => {
  assert.equal(validateChoice('依頼者', ''), '依頼者を選択してください');
  assert.equal(validateChoice('依頼者', '3'), '');
  assert.deepEqual(parseOptionalId('関連する問い合わせ', ''), { value: null, error: '' });
  assert.deepEqual(parseOptionalId('関連する問い合わせ', ' 12 '), { value: 12, error: '' });
  for (const bad of ['0', '-1', '1.5', 'abc']) {
    assert.equal(parseOptionalId('関連する問い合わせ', bad).error, '関連する問い合わせを正しく入力してください', bad);
  }
});

// ---------- 共有する定義 ----------

test('ステータスの定義: ブラウザとサーバーが同じ定義を使っている', () => {
  assert.deepEqual(serverStatus.STATUSES, clientStatus.STATUSES);
  assert.deepEqual(serverStatus.PRIORITIES, clientStatus.PRIORITIES);
  for (const from of clientStatus.STATUSES) {
    assert.deepEqual(serverStatus.availableTransitions(from), clientStatus.availableTransitions(from));
  }
});

test('ステータス変更ボタンの文言(画面設計書 5章)', () => {
  assert.equal(clientStatus.transitionLabel('未対応', '対応中'), '対応中にする');
  assert.equal(clientStatus.transitionLabel('保留', '対応中'), '対応中に戻す');
  assert.equal(clientStatus.transitionLabel('対応中', '保留'), '保留にする');
  assert.equal(clientStatus.transitionLabel('対応中', '完了'), '完了にする');
});

// ---------- 表示形式・操作する担当者 ----------

test('表示形式: 日時は YYYY/MM/DD HH:mm、日付は YYYY/MM/DD', () => {
  assert.equal(formatDateTime('2026-10-12 09:30:15.123'), '2026/10/12 09:30');
  assert.equal(formatDateTime(null), '');
  assert.equal(formatDateTime(''), '');
  assert.equal(formatDate('2026-10-12'), '2026/10/12');
});

test('操作する担当者: 保存・復元でき、保存できない環境でも動作する', () => {
  const data = new Map();
  const storage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  const store = createOperatorStore(storage);
  assert.equal(store.get(), null);
  store.set(3);
  assert.equal(store.get(), 3);
  assert.equal(createOperatorStore(storage).get(), 3); // 次回の表示でも既定値になる
  store.set(null);
  assert.equal(store.get(), null);

  // 保存できない(例外を投げる)環境
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const fallback = createOperatorStore(broken);
  assert.doesNotThrow(() => fallback.set(5));
  assert.equal(fallback.get(), 5); // そのページの間は覚えている
  // 壊れた値は無視する
  data.set('inquiry-management.operatorId', 'abc');
  assert.equal(createOperatorStore(storage).get(), null);
  // storage が無い環境
  assert.equal(createOperatorStore(null).get(), null);
});

// ---------- XSS対策・外部依存の禁止 ----------

function listJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return listJsFiles(full);
    return full.endsWith('.js') ? [full] : [];
  });
}

test('XSS対策: 画面のコードは、HTMLを文字列で組み立てる API を使わない', () => {
  const forbidden = /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(/;
  const files = listJsFiles(path.join(root, 'public', 'js'));
  assert.ok(files.length >= 10);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    assert.ok(!forbidden.test(source), `${path.relative(root, file)} が禁止されたAPIを使っている`);
  }
});

test('外部依存: 画面は外部のCDN・スクリプト・フォントを読み込まない', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.ok(!/https?:\/\//.test(html), 'index.html に外部URLがある');
  const css = fs.readFileSync(path.join(root, 'public', 'css', 'styles.css'), 'utf8');
  assert.ok(!/https?:\/\/|@import/.test(css), 'styles.css に外部URL・@import がある');
  for (const file of listJsFiles(path.join(root, 'public', 'js'))) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!/from\s+['"]https?:/.test(source) && !/import\(['"]https?:/.test(source), `${file} が外部モジュールを読み込む`);
  }
});

test('アクセシビリティ: 全ページ共通の骨格(言語・メッセージ領域・メニュー・ダイアログ)', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /id="messages"/);
  assert.match(html, /<nav id="menu" aria-label="メニュー">/);
  assert.match(html, /<label for="operator">操作する担当者<\/label>/);
  assert.match(html, /<dialog id="dialog"/);
});
