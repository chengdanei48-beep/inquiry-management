import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withApp } from '../test-support/app.js';

const BOM = '﻿';

// 社員: 1 山田(担当者・情報システム) 2 佐藤(担当者・情報システム) 3 鈴木(担当者・総務)
//       4 高橋(人事) 5 田中(営業) 6 退職者(無効な担当者・総務) 7 異動者(無効・営業)
// カテゴリ: 1 PC・ネットワーク 2 アカウント・権限 3 備品・ソフト申請 4 廃止カテゴリ(無効)

/** 問い合わせを直接DBに登録する(集計の検証用。CHECK制約に合う値だけを渡す)。 */
function insert(app, v) {
  const done = v.status === '完了';
  app.db.prepare(`INSERT INTO inquiries
      (title, body, requester_id, category_id, priority, status, assignee_id, resolution,
       received_at, updated_at, completed_at, work_minutes)
      VALUES (?, ?, ?, ?, '中', ?, ?, ?, ?, ?, ?, ?)`)
    .run(v.title ?? `件名${v.at}`, '内容', v.requester, v.category, v.status, v.assignee ?? null,
      done ? '対応した' : null, v.at, v.at, done ? v.at : null, done ? v.minutes : null);
}

function seedDataset(app) {
  const rows = [
    { at: '2026-07-06 09:40:00.000', requester: 5, category: 2, status: '完了', assignee: 1, minutes: 40 },
    { at: '2026-07-14 10:05:00.000', requester: 4, category: 1, status: '完了', assignee: 2, minutes: 325 },
    { at: '2026-08-03 11:15:00.000', requester: 5, category: 3, status: '完了', assignee: 1, minutes: 1030 },
    { at: '2026-08-10 14:20:00.000', requester: 5, category: 1, status: '完了', assignee: 2, minutes: 200 },
    { at: '2026-09-08 16:50:00.000', requester: 4, category: 1, status: '完了', assignee: 2, minutes: 330 },
    { at: '2026-09-24 10:20:00.000', requester: 5, category: 1, status: '対応中', assignee: 1 },
    { at: '2026-09-30 14:00:00.000', requester: 4, category: 2, status: '保留', assignee: 3 },
    { at: '2026-10-08 13:45:00.000', requester: 5, category: 3, status: '未対応' },
    { at: '2026-10-12 09:15:00.000', requester: 4, category: 4, status: '未対応' },
  ];
  rows.forEach((r) => insert(app, r));
}

const summaryOf = async (app, qs) => {
  const res = await app.api('GET', `/api/reports/summary?${qs}`, { operator: null });
  assert.equal(res.status, 200, res.text);
  return res.body;
};

// ---------- 集計(GET /api/reports/summary) ----------

test('集計: 期間全体(手計算の期待値と一致する)', () => withApp(async (app) => {
  seedDataset(app);
  const s = await summaryOf(app, 'from=2026-07-01&to=2026-10-12');
  assert.deepEqual(s.period, { from: '2026-07-01', to: '2026-10-12' });

  // A-01 カテゴリ別件数: PC 4(2,4,5,6件目)、アカウント 2、備品 2、廃止(無効だが件数あり)1
  assert.deepEqual(s.a01, [
    { category: 'PC・ネットワーク', count: 4 },
    { category: 'アカウント・権限', count: 2 },
    { category: '備品・ソフト申請', count: 2 },
    { category: '廃止カテゴリ', count: 1 },
  ]);
  // A-02 部署別件数(依頼者の部署): 営業 5(田中)、人事 4(高橋)。有効な社員がいる部署は0件でも表示
  assert.deepEqual(s.a02, [
    { dept: '営業', count: 5 },
    { dept: '人事', count: 4 },
    { dept: '情報システム', count: 0 },
    { dept: '総務', count: 0 },
  ]);
  // A-03 カテゴリ別平均対応時間(完了のみ): PC (325+200+330)/3=285、アカウント 40、備品 1030、廃止は完了なし
  assert.deepEqual(s.a03, [
    { category: 'PC・ネットワーク', doneCount: 3, avgMinutes: 285 },
    { category: 'アカウント・権限', doneCount: 1, avgMinutes: 40 },
    { category: '備品・ソフト申請', doneCount: 1, avgMinutes: 1030 },
    { category: '廃止カテゴリ', doneCount: 0, avgMinutes: null },
  ]);
  // A-04 担当者別: 山田 完了2・未完了1、佐藤 完了3、鈴木 未完了1、未割当 未完了2
  assert.deepEqual(s.a04, [
    { assignee: '山田 太郎', done: 2, open: 1 },
    { assignee: '佐藤 花子', done: 3, open: 0 },
    { assignee: '鈴木 一郎', done: 0, open: 1 },
    { assignee: '未割当', done: 0, open: 2 },
  ]);
  // A-05 月別受付件数
  assert.deepEqual(s.a05, [
    { month: '2026-07', count: 2 }, { month: '2026-08', count: 2 },
    { month: '2026-09', count: 3 }, { month: '2026-10', count: 2 },
  ]);
  // A-06 ステータス別
  assert.deepEqual(s.a06, [
    { status: '未対応', count: 2 }, { status: '対応中', count: 1 },
    { status: '保留', count: 1 }, { status: '完了', count: 5 },
  ]);
}));

test('集計: 期間で絞り込み、平均対応時間は分未満を切り捨てる', () => withApp(async (app) => {
  seedDataset(app);
  const s = await summaryOf(app, 'from=2026-08-01&to=2026-08-31');
  assert.deepEqual(s.a01.map((r) => r.count), [1, 0, 1]); // 廃止カテゴリは期間内に件数がないため出ない
  assert.deepEqual(s.a05, [{ month: '2026-08', count: 2 }]);
  assert.deepEqual(s.a06.map((r) => r.count), [0, 0, 0, 2]);
  assert.equal(s.a03.find((r) => r.category === 'PC・ネットワーク').avgMinutes, 200);

  // 平均の切り捨て: (10 + 11) / 2 = 10.5 → 10
  insert(app, { at: '2026-11-02 09:00:00.000', requester: 4, category: 2, status: '完了', assignee: 1, minutes: 10 });
  insert(app, { at: '2026-11-03 09:00:00.000', requester: 4, category: 2, status: '完了', assignee: 1, minutes: 11 });
  const nov = await summaryOf(app, 'from=2026-11-01&to=2026-11-30');
  assert.equal(nov.a03.find((r) => r.category === 'アカウント・権限').avgMinutes, 10);
}));

test('集計: 期間の境界(開始日の0時・終了日の23:59:59.999を含み、翌日0時は含まない)', () => withApp(async (app) => {
  insert(app, { at: '2026-08-31 23:59:59.999', requester: 4, category: 1, status: '未対応' });
  insert(app, { at: '2026-09-01 00:00:00.000', requester: 4, category: 1, status: '未対応' });
  const total = (s) => s.a01.reduce((sum, r) => sum + r.count, 0);
  assert.equal(total(await summaryOf(app, 'from=2026-08-31&to=2026-08-31')), 1);
  assert.equal(total(await summaryOf(app, 'from=2026-09-01&to=2026-09-01')), 1);
  assert.equal(total(await summaryOf(app, 'from=2026-08-31&to=2026-09-01')), 2);
}));

test('集計: 該当なしでも、有効なカテゴリと月は0件で返る', () => withApp(async (app) => {
  const s = await summaryOf(app, 'from=2026-01-01&to=2026-03-31');
  assert.deepEqual(s.a01, [
    { category: 'PC・ネットワーク', count: 0 },
    { category: 'アカウント・権限', count: 0 },
    { category: '備品・ソフト申請', count: 0 },
  ]);
  assert.deepEqual(s.a03.map((r) => r.avgMinutes), [null, null, null]);
  assert.deepEqual(s.a04, [
    { assignee: '山田 太郎', done: 0, open: 0 },
    { assignee: '佐藤 花子', done: 0, open: 0 },
    { assignee: '鈴木 一郎', done: 0, open: 0 },
  ]);
  assert.deepEqual(s.a05.map((r) => r.month), ['2026-01', '2026-02', '2026-03']);
  assert.ok(s.a05.every((r) => r.count === 0));
  assert.deepEqual(s.a06.map((r) => r.count), [0, 0, 0, 0]);
}));

test('集計: 年をまたぐ期間の月が連続して並ぶ', () => withApp(async (app) => {
  const s = await summaryOf(app, 'from=2026-11-15&to=2027-02-10');
  assert.deepEqual(s.a05.map((r) => r.month), ['2026-11', '2026-12', '2027-01', '2027-02']);
}));

test('集計: 無効になった担当者も、期間内に担当した件数があれば表示される', () => withApp(async (app) => {
  insert(app, { at: '2026-10-01 09:00:00.000', requester: 4, category: 1, status: '完了', assignee: 6, minutes: 60 });
  const s = await summaryOf(app, 'from=2026-10-01&to=2026-10-31');
  assert.deepEqual(s.a04.find((r) => r.assignee === '退職 者'), { assignee: '退職 者', done: 1, open: 0 });
}));

test('集計: 期間の指定が不正なら 400', () => withApp(async (app) => {
  for (const qs of ['', 'from=2026-07-01', 'to=2026-07-01', 'from=2026-10-13&to=2026-10-12', 'from=2026-02-30&to=2026-03-01', 'from=abc&to=2026-03-01']) {
    const res = await app.api('GET', `/api/reports/summary?${qs}`, { operator: null });
    assert.equal(res.status, 400, qs);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
}));

test('集計: 期間が10年を超えると 400(10年ちょうどは受理)。極端に広い期間でも、すぐに応答する', () => withApp(async (app) => {
  const ok = await app.api('GET', '/api/reports/summary?from=2016-10-12&to=2026-10-12', { operator: null });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.a05.length, 121); // 2016/10 〜 2026/10

  const over = await app.api('GET', '/api/reports/summary?from=2016-10-11&to=2026-10-12', { operator: null });
  assert.equal(over.status, 400);
  assert.deepEqual(over.body.error.fields, [{ field: 'to', message: '集計期間は10年以内にしてください' }]);

  // うるう日の開始(2020-02-29 の10年後は 2030-03-01)
  assert.equal((await app.api('GET', '/api/reports/summary?from=2020-02-29&to=2030-03-01', { operator: null })).status, 200);
  assert.equal((await app.api('GET', '/api/reports/summary?from=2020-02-29&to=2030-03-02', { operator: null })).status, 400);

  // 以前は 0100〜9999年の指定で、集計に約34秒かかり、サーバー全体が止まっていた
  const started = Date.now();
  const huge = await app.api('GET', '/api/reports/summary?from=0100-01-01&to=9999-12-31', { operator: null });
  assert.equal(huge.status, 400);
  assert.ok(Date.now() - started < 1000);

  // CSV出力にも、同じ上限がある
  const csv = await app.api('GET', '/api/reports/export.csv?type=a05&from=2000-01-01&to=2026-10-12', { operator: null });
  assert.equal(csv.status, 400);
}));

// ---------- CSV出力 ----------

test('一覧CSV: BOM付き・ヘッダー・ファイル名・絞り込みを反映し、全件を出力する(ページに関係なく)', () => withApp(async (app) => {
  seedDataset(app);
  const res = await app.api('GET', '/api/inquiries/export.csv', { operator: null });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="inquiries-20261012.csv"');
  assert.ok(res.text.startsWith(BOM));
  const lines = res.text.slice(1).trimEnd().split('\r\n');
  assert.equal(lines[0], 'ID,件名,内容,カテゴリ,依頼者,部署,優先度,ステータス,担当者,受付日時,完了日時,対応内容,対応時間');
  assert.equal(lines.length, 1 + 9);

  const filtered = await app.api('GET', `/api/inquiries/export.csv?status=${encodeURIComponent('完了')}&page=2`, { operator: null });
  assert.equal(filtered.text.slice(1).trimEnd().split('\r\n').length, 1 + 5); // page は無視される
}));

test('一覧CSV: 完了した問い合わせの対応時間は H:mm、未完了は空欄。並び順は一覧と同じ', () => withApp(async (app) => {
  seedDataset(app);
  const res = await app.api('GET', '/api/inquiries/export.csv?sort=received&dir=asc', { operator: null });
  const lines = res.text.slice(1).trimEnd().split('\r\n');
  assert.match(lines[1], /,2026-07-06 09:40:00\.000,2026-07-06 09:40:00\.000,対応した,0:40$/);
  assert.match(lines[9], /,未対応,,2026-10-12 09:15:00\.000,,,$/);
}));

test('一覧CSV: 式として実行されうる件名は無害化され、カンマ・引用符・改行は正しく囲まれる', () => withApp(async (app) => {
  await app.create({ title: '=HYPERLINK("http://x","click")', body: 'a,b' });
  await app.create({ title: '+1', body: '@cmd' });
  const res = await app.api('GET', '/api/inquiries/export.csv?sort=received&dir=asc', { operator: null });
  assert.ok(res.text.includes(`"'=HYPERLINK(""http://x"",""click"")"`), res.text);
  assert.ok(res.text.includes(`,"a,b",`));
  assert.ok(res.text.includes(`,'+1,`));
  assert.ok(res.text.includes(`,'@cmd,`));
}));

test('一覧CSV: 不正な絞り込みは 400、該当なしはヘッダーのみ', () => withApp(async (app) => {
  const bad = await app.api('GET', '/api/inquiries/export.csv?status=削除', { operator: null });
  assert.equal(bad.status, 400);
  const empty = await app.api('GET', '/api/inquiries/export.csv', { operator: null });
  assert.equal(empty.status, 200);
  assert.equal(empty.text.slice(1).trimEnd().split('\r\n').length, 1);
}));

test('集計CSV: 種類ごとのヘッダーと値、値なしは空欄', () => withApp(async (app) => {
  seedDataset(app);
  const get = async (type) => (await app.api('GET', `/api/reports/export.csv?type=${type}&from=2026-07-01&to=2026-10-12`, { operator: null }));
  const a01 = await get('a01');
  assert.equal(a01.status, 200);
  assert.equal(a01.headers.get('content-disposition'), 'attachment; filename="report-a01-2026-07-01_2026-10-12.csv"');
  assert.equal(a01.text, `${BOM}カテゴリ,件数\r\nPC・ネットワーク,4\r\nアカウント・権限,2\r\n備品・ソフト申請,2\r\n廃止カテゴリ,1\r\n`);
  const a03 = await get('a03');
  assert.equal(a03.text.split('\r\n')[1], 'PC・ネットワーク,3,4:45');
  assert.equal(a03.text.split('\r\n')[4], '廃止カテゴリ,0,'); // 完了なしは空欄
  const a05 = await get('a05');
  assert.equal(a05.text.split('\r\n')[1], '2026/07,2');
  for (const type of ['a02', 'a04', 'a06']) assert.equal((await get(type)).status, 200, type);
}));

test('集計CSV: 種類・期間が不正なら 400', () => withApp(async (app) => {
  for (const qs of ['type=a07&from=2026-07-01&to=2026-07-31', 'from=2026-07-01&to=2026-07-31', 'type=a01', 'type=a01&from=2026-08-01&to=2026-07-01']) {
    const res = await app.api('GET', `/api/reports/export.csv?${qs}`, { operator: null });
    assert.equal(res.status, 400, qs);
  }
}));

// ---------- 月次保存 ----------

test('月次保存: CSV 6 + SVG 6 を作成し、一覧とダウンロードができる', () => withApp(async (app) => {
  seedDataset(app);
  app.clock.set('2026-10-12 10:00:00.000');
  const res = await app.api('POST', '/api/reports/monthly', { body: { month: '2026-09' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.month, '2026-09');
  assert.equal(res.body.savedAt, '2026-10-12 10:00:00.000');
  assert.equal(res.body.overwritten, false);
  assert.equal(res.body.files.length, 12);

  const dir = path.join(app.reportsDir, '2026-09');
  for (const f of res.body.files) assert.ok(fs.existsSync(path.join(dir, f)), f);

  const list = await app.api('GET', '/api/reports/monthly', { operator: null });
  assert.deepEqual(list.body.items.map((i) => [i.month, i.savedAt]), [['2026-09', '2026-10-12 10:00:00.000']]);

  // 2026-09 の受付は 3 件(8日・24日・30日)
  const csv = await app.api('GET', '/api/reports/monthly/2026-09/a01.csv', { operator: null });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.equal(csv.headers.get('content-disposition'), 'attachment; filename="2026-09-a01.csv"');
  assert.equal(csv.text, `${BOM}カテゴリ,件数\r\nPC・ネットワーク,2\r\nアカウント・権限,1\r\n備品・ソフト申請,0\r\n`);

  const svg = await app.api('GET', '/api/reports/monthly/2026-09/a05.svg', { operator: null });
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
  assert.ok(svg.text.startsWith('<?xml'));
  assert.ok(svg.text.includes('A-05 月別受付件数の推移(2026/09)'), 'SVGのタイトルに対象月が含まれる');
  assert.match(svg.text, />2026\/09<\/text>/);
}));

test('月次保存: 同じ月を保存し直すと上書きされる', () => withApp(async (app) => {
  seedDataset(app);
  app.clock.set('2026-10-12 10:00:00.000');
  await app.api('POST', '/api/reports/monthly', { body: { month: '2026-09' } });
  // データが増えたあとで保存し直す
  insert(app, { at: '2026-09-15 09:00:00.000', requester: 4, category: 3, status: '未対応' });
  app.clock.set('2026-10-13 11:00:00.000');
  const again = await app.api('POST', '/api/reports/monthly', { body: { month: '2026-09' } });
  assert.equal(again.status, 201);
  assert.equal(again.body.overwritten, true);
  const list = await app.api('GET', '/api/reports/monthly', { operator: null });
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].savedAt, '2026-10-13 11:00:00.000');
  const csv = await app.api('GET', '/api/reports/monthly/2026-09/a01.csv', { operator: null });
  assert.match(csv.text, /備品・ソフト申請,1\r\n/);
  // 一時ディレクトリが残らない
  assert.deepEqual(fs.readdirSync(app.reportsDir), ['2026-09']);
}));

test('月次保存: 月ごとに別のディレクトリで、一覧は月順に並ぶ。月の末日・うるう日も正しい', () => withApp(async (app) => {
  insert(app, { at: '2028-02-29 09:00:00.000', requester: 4, category: 1, status: '未対応' });
  await app.api('POST', '/api/reports/monthly', { body: { month: '2028-02' } });
  await app.api('POST', '/api/reports/monthly', { body: { month: '2026-09' } });
  const list = await app.api('GET', '/api/reports/monthly', { operator: null });
  assert.deepEqual(list.body.items.map((i) => i.month), ['2026-09', '2028-02']);
  const csv = await app.api('GET', '/api/reports/monthly/2028-02/a01.csv', { operator: null });
  assert.match(csv.text, /PC・ネットワーク,1\r\n/); // うるう日(2/29)を含む
}));

test('月次保存: 保存が無いときの一覧は空', () => withApp(async (app) => {
  const list = await app.api('GET', '/api/reports/monthly', { operator: null });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.items, []);
}));

test('月次保存: 対象月が不正なら 400、操作者が無ければ 400 で、何も作られない', () => withApp(async (app) => {
  for (const month of [undefined, '', '2026-13', '2026-9', '202609', 'abc', 202609]) {
    const res = await app.api('POST', '/api/reports/monthly', { body: { month } });
    assert.equal(res.status, 400, String(month));
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
  const noOperator = await app.api('POST', '/api/reports/monthly', { body: { month: '2026-09' }, operator: null });
  assert.equal(noOperator.status, 400);
  assert.equal(noOperator.body.error.code, 'OPERATOR_REQUIRED');
  assert.deepEqual(fs.readdirSync(app.reportsDir), []);
}));

test('月次ダウンロード: 固定のファイル名以外は 404(パス・トラバーサルを含む)', () => withApp(async (app) => {
  await app.api('POST', '/api/reports/monthly', { body: { month: '2026-09' } });
  const cases = [
    '/api/reports/monthly/2026-09/meta.json', // 内部のファイル
    '/api/reports/monthly/2026-09/a07.csv',
    '/api/reports/monthly/2026-09/a01.txt',
    '/api/reports/monthly/2026-09/..%2Fmeta.json',
    '/api/reports/monthly/..%2Fx/a01.csv',
    '/api/reports/monthly/2026-9/a01.csv',
    '/api/reports/monthly/2026-10/a01.csv', // 未保存の月
    '/api/reports/monthly/2026-09/a01.csv%00.svg',
  ];
  for (const url of cases) {
    const res = await app.api('GET', url, { operator: null });
    assert.equal(res.status, 404, url);
  }
}));

test('CSV: 応答の先頭バイトは UTF-8 の BOM(EF BB BF)', () => withApp(async (app) => {
  const res = await app.api('GET', '/api/inquiries/export.csv', { operator: null });
  assert.deepEqual([...res.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const report = await app.api('GET', '/api/reports/export.csv?type=a01&from=2026-07-01&to=2026-07-31', { operator: null });
  assert.deepEqual([...report.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  await app.api('POST', '/api/reports/monthly', { body: { month: '2026-09' } });
  const monthly = await app.api('GET', '/api/reports/monthly/2026-09/a01.csv', { operator: null });
  assert.deepEqual([...monthly.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
}));
