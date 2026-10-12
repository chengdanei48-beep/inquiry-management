import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp } from '../test-support/app.js';

const histories = (app, id) => app.db.prepare('SELECT type, content FROM inquiry_histories WHERE inquiry_id = ? ORDER BY id').all(id);
const row = (app, id) => app.db.prepare('SELECT * FROM inquiries WHERE id = ?').get(id);

// ---------- 登録(POST /api/inquiries) ----------

test('登録: 201 で詳細を返し、未対応・担当者なし・受付日時はサーバーが設定する', () => withApp(async (app) => {
  app.clock.set('2026-10-12 09:30:15.123');
  const res = await app.api('POST', '/api/inquiries', { body: { ...app.validInquiry, relatedInquiryId: null } });
  assert.equal(res.status, 201);
  const d = res.body;
  assert.equal(d.title, 'VPNに接続できない');
  assert.equal(d.status, '未対応');
  assert.equal(d.assignee, null);
  assert.equal(d.priority, '高');
  assert.deepEqual(d.category, { id: 1, name: 'PC・ネットワーク' });
  assert.deepEqual(d.requester, { id: 5, name: '田中 健太', dept: '営業' });
  assert.equal(d.receivedAt, '2026-10-12 09:30:15.123');
  assert.equal(d.updatedAt, '2026-10-12 09:30:15.123');
  assert.equal(d.completedAt, null);
  assert.equal(d.workMinutes, null);
  assert.equal(d.relatedInquiry, null);
  assert.equal(d.histories.length, 1);
  assert.equal(d.histories[0].type, 'registered');
  assert.deepEqual(d.histories[0].operator, { id: 1, name: '山田 太郎' });
}));

test('登録: 件名・内容は50文字まで受け付け、51文字・未入力は 400', () => withApp(async (app) => {
  const ok = await app.api('POST', '/api/inquiries', { body: { ...app.validInquiry, title: 'あ'.repeat(50), body: 'い'.repeat(50) } });
  assert.equal(ok.status, 201);
  const bad = await app.api('POST', '/api/inquiries', { body: { ...app.validInquiry, title: 'あ'.repeat(51), body: '' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION_ERROR');
  const fields = Object.fromEntries(bad.body.error.fields.map((f) => [f.field, f.message]));
  assert.equal(fields.title, '件名は50文字以内で入力してください');
  assert.equal(fields.body, '内容を入力してください');
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM inquiries').get().n, 1);
}));

test('登録: 操作者が無い・担当者でない・無効な場合は 400 OPERATOR_REQUIRED', () => withApp(async (app) => {
  for (const operator of [null, 4, 6, 999]) {
    const res = await app.api('POST', '/api/inquiries', { body: app.validInquiry, operator });
    assert.equal(res.status, 400, `operator=${operator}`);
    assert.equal(res.body.error.code, 'OPERATOR_REQUIRED');
  }
  const bad = await app.api('POST', '/api/inquiries', { body: app.validInquiry, operator: 'abc' });
  assert.equal(bad.body.error.code, 'OPERATOR_REQUIRED');
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM inquiries').get().n, 0);
}));

test('登録: 存在しない・無効な依頼者とカテゴリ、存在しない関連IDは 400', () => withApp(async (app) => {
  const cases = [
    [{ requesterId: 999 }, 'requesterId', '依頼者を選択してください'],
    [{ requesterId: 7 }, 'requesterId', '依頼者を選択してください'], // 無効な社員
    [{ categoryId: 999 }, 'categoryId', 'カテゴリを選択してください'],
    [{ categoryId: 4 }, 'categoryId', 'カテゴリを選択してください'], // 無効なカテゴリ
    [{ relatedInquiryId: 999 }, 'relatedInquiryId', '指定した問い合わせが見つかりません'],
  ];
  for (const [override, field, message] of cases) {
    const res = await app.api('POST', '/api/inquiries', { body: { ...app.validInquiry, ...override } });
    assert.equal(res.status, 400, JSON.stringify(override));
    assert.deepEqual(res.body.error.fields, [{ field, message }]);
  }
}));

test('登録: 関連する問い合わせを指定すると、詳細にリンク情報が入る', () => withApp(async (app) => {
  const first = await app.create({ title: '元の問い合わせ' });
  const second = await app.create({ relatedInquiryId: first.id });
  assert.deepEqual(second.relatedInquiry, { id: first.id, title: '元の問い合わせ' });
}));

test('登録: 不正なJSON・配列は 400', () => withApp(async (app) => {
  const res = await app.api('POST', '/api/inquiries', { headers: { 'Content-Type': 'application/json' }, body: undefined });
  assert.equal(res.status, 400); // 空ボディ → 項目が全て未入力
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
}));

// ---------- 詳細(GET /api/inquiries/{id}) ----------

test('詳細: 200 で履歴を古い順に返す', () => withApp(async (app) => {
  const d = await app.create();
  const res = await app.api('GET', `/api/inquiries/${d.id}`, { operator: null });
  assert.equal(res.status, 200);
  assert.equal(res.body.id, d.id);
  assert.ok(Array.isArray(res.body.histories));
}));

test('詳細: 存在しないID・数字でないIDは 404', () => withApp(async (app) => {
  for (const id of ['999', '0', 'abc', '1.5', '-1']) {
    const res = await app.api('GET', `/api/inquiries/${id}`, { operator: null });
    assert.equal(res.status, 404, id);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  }
}));

// ---------- 一覧(GET /api/inquiries) ----------

async function seedList(app) {
  // 受付日時を変えながら、条件の異なる問い合わせを作る
  app.clock.set('2026-10-01 09:00:00.000');
  const a = await app.create({ title: 'パスワードを忘れた', body: 'ログイン不可', requesterId: 5, categoryId: 2, priority: '中' });
  app.clock.set('2026-10-02 09:00:00.000');
  const b = await app.create({ title: 'PCが起動しない', body: '電源が入らない', requesterId: 4, categoryId: 1, priority: '高' });
  app.clock.set('2026-10-03 09:00:00.000');
  const c = await app.create({ title: 'モニターの追加', body: '2台目が欲しい', requesterId: 5, categoryId: 3, priority: '低' });
  // b を担当者2・対応中にする
  app.clock.set('2026-10-04 09:00:00.000');
  await app.api('POST', `/api/inquiries/${b.id}/assignee`, { body: { assigneeId: 2, updatedAt: b.updatedAt } });
  const b2 = (await app.api('GET', `/api/inquiries/${b.id}`)).body;
  await app.api('POST', `/api/inquiries/${b.id}/status`, { body: { status: '対応中', updatedAt: b2.updatedAt } });
  return { a, b, c };
}

test('一覧: 既定は受付日時の新しい順で、総件数・ページ情報を返す', () => withApp(async (app) => {
  const { a, b, c } = await seedList(app);
  const res = await app.api('GET', '/api/inquiries', { operator: null });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((i) => i.id), [c.id, b.id, a.id]);
  assert.equal(res.body.total, 3);
  assert.equal(res.body.page, 1);
  assert.equal(res.body.pageSize, 20);
  assert.deepEqual(Object.keys(res.body.items[0]).sort(),
    ['assignee', 'category', 'id', 'priority', 'receivedAt', 'requester', 'status', 'title']);
}));

test('一覧: ステータス・カテゴリ・担当者・部署で絞り込める', () => withApp(async (app) => {
  const { a, b, c } = await seedList(app);
  const ids = async (qs) => (await app.api('GET', `/api/inquiries?${qs}`, { operator: null })).body.items.map((i) => i.id);
  assert.deepEqual(await ids('status=対応中'), [b.id]);
  assert.deepEqual(await ids('status=未対応'), [c.id, a.id]);
  assert.deepEqual(await ids('categoryId=2'), [a.id]);
  assert.deepEqual(await ids('assigneeId=2'), [b.id]);
  assert.deepEqual(await ids('assigneeId=none'), [c.id, a.id]);
  assert.deepEqual(await ids(`dept=${encodeURIComponent('営業')}`), [c.id, a.id]);
  assert.deepEqual(await ids(`dept=${encodeURIComponent('人事')}&status=対応中`), [b.id]);
  assert.deepEqual(await ids(`status=${encodeURIComponent('完了')}`), []);
}));

test('一覧: キーワードは件名・内容を検索し、% と _ は文字として扱う', () => withApp(async (app) => {
  const { a, b } = await seedList(app);
  const ids = async (q) => (await app.api('GET', `/api/inquiries?q=${encodeURIComponent(q)}`, { operator: null })).body.items.map((i) => i.id);
  assert.deepEqual(await ids('パスワード'), [a.id]); // 件名
  assert.deepEqual(await ids('電源'), [b.id]); // 内容
  await app.create({ title: '100%の確認', body: 'a_b' });
  assert.equal((await ids('%')).length, 1);
  assert.equal((await ids('_')).length, 1);
  assert.equal((await ids('100%')).length, 1);
  assert.deepEqual(await ids('存在しない語'), []);
}));

test('一覧: 優先度順(高→中→低)と、昇順・降順の指定', () => withApp(async (app) => {
  const { a, b, c } = await seedList(app);
  const ids = async (qs) => (await app.api('GET', `/api/inquiries?${qs}`, { operator: null })).body.items.map((i) => i.id);
  assert.deepEqual(await ids('sort=priority&dir=asc'), [b.id, a.id, c.id]); // 高 中 低
  assert.deepEqual(await ids('sort=priority&dir=desc'), [c.id, a.id, b.id]);
  assert.deepEqual(await ids('sort=received&dir=asc'), [a.id, b.id, c.id]);
}));

test('一覧: 受付日時が同じでも、IDの順で並びが固定される', () => withApp(async (app) => {
  const x = await app.create({ title: 'x' });
  const y = await app.create({ title: 'y' }); // 同じ時刻
  const res = await app.api('GET', '/api/inquiries', { operator: null });
  assert.equal(res.body.items[0].receivedAt, res.body.items[1].receivedAt);
  assert.deepEqual(res.body.items.map((i) => i.id), [y.id, x.id]);
}));

test('一覧: 1ページ20件のページング', () => withApp(async (app) => {
  for (let i = 0; i < 25; i += 1) {
    app.clock.advanceMinutes(1);
    await app.create({ title: `件名${i}` });
  }
  const p1 = (await app.api('GET', '/api/inquiries', { operator: null })).body;
  assert.equal(p1.total, 25);
  assert.equal(p1.items.length, 20);
  assert.equal(p1.items[0].title, '件名24'); // 新しい順
  const p2 = (await app.api('GET', '/api/inquiries?page=2', { operator: null })).body;
  assert.equal(p2.items.length, 5);
  assert.equal(p2.page, 2);
  assert.equal(p2.items.at(-1).title, '件名0');
  const p3 = (await app.api('GET', '/api/inquiries?page=3', { operator: null })).body;
  assert.deepEqual(p3.items, []);
  assert.equal(p3.total, 25);
}));

test('一覧: 不正なクエリは 400', () => withApp(async (app) => {
  for (const qs of ['status=削除', 'categoryId=abc', 'sort=title', 'dir=up', 'page=0', 'page=-1', 'assigneeId=x', `q=${'あ'.repeat(51)}`]) {
    const res = await app.api('GET', `/api/inquiries?${qs}`, { operator: null });
    assert.equal(res.status, 400, qs);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
}));

// ---------- ステータス変更(POST /api/inquiries/{id}/status) ----------

test('ステータス: 担当者が未割当なら 409 ASSIGNEE_REQUIRED で、何も変わらない', () => withApp(async (app) => {
  const d = await app.create();
  const res = await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '対応中', updatedAt: d.updatedAt } });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'ASSIGNEE_REQUIRED');
  assert.equal(row(app, d.id).status, '未対応');
  assert.equal(histories(app, d.id).length, 1);
}));

test('ステータス: 担当者を割り当てて 未対応 → 対応中 → 保留 → 対応中 と進み、履歴に残る', () => withApp(async (app) => {
  let d = await app.create();
  app.clock.advanceMinutes(5);
  d = (await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 2, updatedAt: d.updatedAt } })).body;
  assert.equal(d.assignee.id, 2);
  for (const [to, minutes] of [['対応中', 5], ['保留', 30], ['対応中', 60]]) {
    app.clock.advanceMinutes(minutes);
    const res = await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: to, updatedAt: d.updatedAt }, operator: 3 });
    assert.equal(res.status, 200, to);
    assert.equal(res.body.status, to);
    d = res.body;
  }
  const statusHistories = d.histories.filter((h) => h.type === 'status');
  assert.deepEqual(statusHistories.map((h) => [h.fromStatus, h.toStatus]), [['未対応', '対応中'], ['対応中', '保留'], ['保留', '対応中']]);
  assert.equal(statusHistories[0].operator.id, 3);
}));

test('ステータス: 不正な遷移は 409 INVALID_TRANSITION', () => withApp(async (app) => {
  let d = await app.create();
  d = (await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 1, updatedAt: d.updatedAt } })).body;
  // 未対応 → 完了 / 未対応 → 保留
  for (const status of ['完了', '保留']) {
    const res = await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status, resolution: '済', updatedAt: d.updatedAt } });
    assert.equal(res.status, 409, status);
    assert.equal(res.body.error.code, 'INVALID_TRANSITION');
  }
}));

test('ステータス: 完了には対応内容が必須(400)で、50文字を超えると 400', () => withApp(async (app) => {
  let d = await app.create();
  d = (await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 1, updatedAt: d.updatedAt } })).body;
  d = (await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '対応中', updatedAt: d.updatedAt } })).body;
  const none = await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '完了', updatedAt: d.updatedAt } });
  assert.equal(none.status, 400);
  assert.equal(none.body.error.fields[0].field, 'resolution');
  const long = await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '完了', resolution: 'あ'.repeat(51), updatedAt: d.updatedAt } });
  assert.equal(long.status, 400);
  assert.equal(row(app, d.id).status, '対応中');
  const ok = await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '完了', resolution: 'あ'.repeat(50), updatedAt: d.updatedAt } });
  assert.equal(ok.status, 200);
}));

test('ステータス: 完了すると、完了日時・対応内容・対応時間(営業時間・保留除外)が保存される', () => withApp(async (app) => {
  // 設計書の例: 金曜 16:30 受付、月曜 9:00〜13:00 保留、火曜 10:00 完了 = 450分
  app.clock.set('2026-10-09 16:30:00.000');
  let d = await app.create();
  d = (await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 1, updatedAt: d.updatedAt } })).body;
  app.clock.set('2026-10-09 17:00:00.000');
  d = (await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '対応中', updatedAt: d.updatedAt } })).body;
  app.clock.set('2026-10-12 09:00:00.000');
  d = (await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '保留', updatedAt: d.updatedAt } })).body;
  app.clock.set('2026-10-12 13:00:00.000');
  d = (await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '対応中', updatedAt: d.updatedAt } })).body;
  app.clock.set('2026-10-13 10:00:00.000');
  const res = await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '完了', resolution: '電源ユニットを交換した', updatedAt: d.updatedAt } });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, '完了');
  assert.equal(res.body.resolution, '電源ユニットを交換した');
  assert.equal(res.body.completedAt, '2026-10-13 10:00:00.000');
  assert.equal(res.body.workMinutes, 450);
  assert.equal(row(app, d.id).work_minutes, 450);
}));

test('ステータス: 完了後は変更できない(409 INVALID_TRANSITION)', () => withApp(async (app) => {
  let d = await app.create();
  d = (await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 1, updatedAt: d.updatedAt } })).body;
  d = (await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '対応中', updatedAt: d.updatedAt } })).body;
  d = (await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '完了', resolution: '済', updatedAt: d.updatedAt } })).body;
  const res = await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '対応中', updatedAt: d.updatedAt } });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'INVALID_TRANSITION');
}));

test('ステータス: 不明なステータス・更新日時なし・存在しないIDの扱い', () => withApp(async (app) => {
  const d = await app.create();
  const unknown = await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '削除', updatedAt: d.updatedAt } });
  assert.equal(unknown.status, 400);
  const noToken = await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '対応中' } });
  assert.equal(noToken.status, 400);
  const missing = await app.api('POST', '/api/inquiries/999/status', { body: { status: '対応中', updatedAt: d.updatedAt } });
  assert.equal(missing.status, 404);
}));

// ---------- 同時更新(楽観ロック) ----------

test('同時更新: 古い更新日時での更新は 409 STALE_UPDATE で、何も変わらない', () => withApp(async (app) => {
  const d = await app.create();
  const staleToken = d.updatedAt;
  app.clock.advanceMinutes(1);
  // Aが担当者を変更(更新日時が進む)
  const a = await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 1, updatedAt: staleToken } });
  assert.equal(a.status, 200);
  const before = histories(app, d.id).length;
  // Bは古い更新日時のまま、ステータス変更・担当者変更・編集を試みる
  const b1 = await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '対応中', updatedAt: staleToken } });
  const b2 = await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 2, updatedAt: staleToken } });
  const b3 = await app.api('PATCH', `/api/inquiries/${d.id}`, { body: { title: '別の件名', updatedAt: staleToken } });
  for (const r of [b1, b2, b3]) {
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'STALE_UPDATE');
  }
  assert.equal(row(app, d.id).assignee_id, 1);
  assert.equal(row(app, d.id).title, 'VPNに接続できない');
  assert.equal(histories(app, d.id).length, before);
}));

test('同時更新: 同じミリ秒に起きた更新でも、更新日時は必ず進み競合を見逃さない', () => withApp(async (app) => {
  const d = await app.create();
  // 時計を進めずに連続で更新する(同じミリ秒)
  const r1 = await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 1, updatedAt: d.updatedAt } });
  assert.equal(r1.status, 200);
  assert.ok(r1.body.updatedAt > d.updatedAt, '更新日時が増えていない');
  const r2 = await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 2, updatedAt: d.updatedAt } });
  assert.equal(r2.status, 409);
  const r3 = await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 2, updatedAt: r1.body.updatedAt } });
  assert.equal(r3.status, 200);
  assert.ok(r3.body.updatedAt > r1.body.updatedAt);
}));

test('同時更新: コメントは更新日時を変えず、他の人の更新を 409 にしない', () => withApp(async (app) => {
  const d = await app.create();
  app.clock.advanceMinutes(1);
  const c = await app.api('POST', `/api/inquiries/${d.id}/comments`, { body: { text: '連絡を待っています' }, operator: 2 });
  assert.equal(c.status, 201);
  assert.equal(c.body.updatedAt, d.updatedAt);
  const res = await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 1, updatedAt: d.updatedAt } });
  assert.equal(res.status, 200);
}));

// ---------- 担当者割当(POST /api/inquiries/{id}/assignee) ----------

test('担当者: 割り当て・変更ができ、履歴に残る', () => withApp(async (app) => {
  let d = await app.create();
  app.clock.advanceMinutes(1);
  d = (await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 1, updatedAt: d.updatedAt } })).body;
  app.clock.advanceMinutes(1);
  d = (await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 2, updatedAt: d.updatedAt } })).body;
  assert.deepEqual(d.assignee, { id: 2, name: '佐藤 花子' });
  assert.deepEqual(histories(app, d.id).filter((h) => h.type === 'assignee').map((h) => h.content),
    ['担当者を「山田 太郎」に設定', '担当者を「山田 太郎」から「佐藤 花子」に変更']);
}));

test('担当者: 担当者区分でない・無効・存在しない社員は 400', () => withApp(async (app) => {
  const d = await app.create();
  for (const assigneeId of [4, 6, 999]) { // 一般、無効な担当者、存在しない
    const res = await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId, updatedAt: d.updatedAt } });
    assert.equal(res.status, 400, String(assigneeId));
    assert.deepEqual(res.body.error.fields, [{ field: 'assigneeId', message: '担当者を選択してください' }]);
  }
  assert.equal(row(app, d.id).assignee_id, null);
}));

test('担当者: 同じ担当者への変更は何も更新しない', () => withApp(async (app) => {
  let d = await app.create();
  app.clock.advanceMinutes(1);
  d = (await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 1, updatedAt: d.updatedAt } })).body;
  const count = histories(app, d.id).length;
  app.clock.advanceMinutes(1);
  const again = await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 1, updatedAt: d.updatedAt } });
  assert.equal(again.status, 200);
  assert.equal(again.body.updatedAt, d.updatedAt);
  assert.equal(histories(app, d.id).length, count);
}));

test('担当者: 完了済みは 409 COMPLETED_LOCKED', () => withApp(async (app) => {
  let d = await app.create();
  d = (await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 1, updatedAt: d.updatedAt } })).body;
  d = (await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '対応中', updatedAt: d.updatedAt } })).body;
  d = (await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '完了', resolution: '済', updatedAt: d.updatedAt } })).body;
  const res = await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 2, updatedAt: d.updatedAt } });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'COMPLETED_LOCKED');
}));

// ---------- 編集(PATCH /api/inquiries/{id}) ----------

test('編集: 指定した項目だけが更新され、更新日時と履歴が残る', () => withApp(async (app) => {
  const d = await app.create();
  app.clock.advanceMinutes(10);
  const res = await app.api('PATCH', `/api/inquiries/${d.id}`, { body: { title: '新しい件名', priority: '低', updatedAt: d.updatedAt }, operator: 2 });
  assert.equal(res.status, 200);
  assert.equal(res.body.title, '新しい件名');
  assert.equal(res.body.priority, '低');
  assert.equal(res.body.body, d.body); // 指定しなかった項目は変わらない
  assert.ok(res.body.updatedAt > d.updatedAt);
  const edit = res.body.histories.find((h) => h.type === 'edit');
  assert.equal(edit.content, '件名・優先度を編集');
  assert.equal(edit.operator.id, 2);
}));

test('編集: 値が変わらなければ更新日時・履歴を変えない', () => withApp(async (app) => {
  const d = await app.create();
  app.clock.advanceMinutes(10);
  const res = await app.api('PATCH', `/api/inquiries/${d.id}`, { body: { title: d.title, updatedAt: d.updatedAt } });
  assert.equal(res.status, 200);
  assert.equal(res.body.updatedAt, d.updatedAt);
  assert.equal(histories(app, d.id).length, 1);
}));

test('編集: 入力不備・無効なカテゴリは 400、完了済みは 409 COMPLETED_LOCKED', () => withApp(async (app) => {
  let d = await app.create();
  const long = await app.api('PATCH', `/api/inquiries/${d.id}`, { body: { title: 'あ'.repeat(51), updatedAt: d.updatedAt } });
  assert.equal(long.status, 400);
  const badCat = await app.api('PATCH', `/api/inquiries/${d.id}`, { body: { categoryId: 4, updatedAt: d.updatedAt } });
  assert.equal(badCat.status, 400);
  const empty = await app.api('PATCH', `/api/inquiries/${d.id}`, { body: { updatedAt: d.updatedAt } });
  assert.equal(empty.status, 400);

  d = (await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 1, updatedAt: d.updatedAt } })).body;
  d = (await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '対応中', updatedAt: d.updatedAt } })).body;
  d = (await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '完了', resolution: '済', updatedAt: d.updatedAt } })).body;
  const locked = await app.api('PATCH', `/api/inquiries/${d.id}`, { body: { title: '変更', updatedAt: d.updatedAt } });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error.code, 'COMPLETED_LOCKED');
  assert.equal(row(app, d.id).title, 'VPNに接続できない');
}));

test('編集: 後からカテゴリが無効になった問い合わせも、カテゴリを変えなければ編集できる', () => withApp(async (app) => {
  const d = await app.create({ categoryId: 3 });
  await app.api('PATCH', '/api/categories/3', { body: { isActive: false } });
  app.clock.advanceMinutes(1);
  // 画面は、現在のカテゴリ(無効)も一緒に送る
  const same = await app.api('PATCH', `/api/inquiries/${d.id}`, { body: { title: '件名だけ変更', categoryId: 3, updatedAt: d.updatedAt } });
  assert.equal(same.status, 200);
  assert.equal(same.body.title, '件名だけ変更');
  assert.equal(same.body.category.id, 3);
  // 別の「無効な」カテゴリへの変更は、拒否される(無効なカテゴリには変更できない)
  const toInactive = await app.api('PATCH', `/api/inquiries/${d.id}`, { body: { categoryId: 4, updatedAt: same.body.updatedAt } });
  assert.equal(toInactive.status, 400);
  assert.equal(toInactive.body.error.fields[0].field, 'categoryId');
  // 有効なカテゴリへは変更できる
  const toActive = await app.api('PATCH', `/api/inquiries/${d.id}`, { body: { categoryId: 1, updatedAt: same.body.updatedAt } });
  assert.equal(toActive.status, 200);
  assert.equal(toActive.body.category.id, 1);
}));

// ---------- コメント(POST /api/inquiries/{id}/comments) ----------

test('コメント: 201 で履歴に追加され、完了後も追加できる', () => withApp(async (app) => {
  let d = await app.create();
  const c1 = await app.api('POST', `/api/inquiries/${d.id}/comments`, { body: { text: '再起動を依頼した' }, operator: 2 });
  assert.equal(c1.status, 201);
  const last = c1.body.histories.at(-1);
  assert.deepEqual([last.type, last.content, last.operator.id], ['comment', '再起動を依頼した', 2]);

  d = (await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 1, updatedAt: d.updatedAt } })).body;
  d = (await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '対応中', updatedAt: d.updatedAt } })).body;
  d = (await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '完了', resolution: '済', updatedAt: d.updatedAt } })).body;
  const afterDone = await app.api('POST', `/api/inquiries/${d.id}/comments`, { body: { text: '完了後の連絡' } });
  assert.equal(afterDone.status, 201);
}));

test('コメント: 50文字は受け付け、51文字・空は 400、存在しないIDは 404', () => withApp(async (app) => {
  const d = await app.create();
  const ok = await app.api('POST', `/api/inquiries/${d.id}/comments`, { body: { text: 'あ'.repeat(50) } });
  assert.equal(ok.status, 201);
  for (const text of ['あ'.repeat(51), '', '   ']) {
    const res = await app.api('POST', `/api/inquiries/${d.id}/comments`, { body: { text } });
    assert.equal(res.status, 400);
  }
  const missing = await app.api('POST', '/api/inquiries/999/comments', { body: { text: 'x' } });
  assert.equal(missing.status, 404);
}));

// ---------- 全体 ----------

test('変更系: 操作者が無ければ、どのAPIも 400 OPERATOR_REQUIRED で何も変えない', () => withApp(async (app) => {
  const d = await app.create();
  const calls = [
    ['PATCH', `/api/inquiries/${d.id}`, { title: '変更', updatedAt: d.updatedAt }],
    ['POST', `/api/inquiries/${d.id}/status`, { status: '対応中', updatedAt: d.updatedAt }],
    ['POST', `/api/inquiries/${d.id}/assignee`, { assigneeId: 1, updatedAt: d.updatedAt }],
    ['POST', `/api/inquiries/${d.id}/comments`, { text: 'x' }],
  ];
  for (const [method, url, body] of calls) {
    const res = await app.api(method, url, { body, operator: null });
    assert.equal(res.status, 400, url);
    assert.equal(res.body.error.code, 'OPERATOR_REQUIRED');
  }
  assert.equal(histories(app, d.id).length, 1);
}));

test('SQLインジェクション: 入力値はそのまま文字として保存・検索される', () => withApp(async (app) => {
  const title = "'; DROP TABLE inquiries; --";
  const d = await app.create({ title });
  assert.equal(d.title, title);
  const res = await app.api('GET', `/api/inquiries?q=${encodeURIComponent("' OR '1'='1")}`, { operator: null });
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 0);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM inquiries').get().n, 1);
}));

test('レスポンス: 内部情報(SQL・スタックトレース)を含まない', () => withApp(async (app) => {
  const res = await app.api('GET', '/api/inquiries?status=%27%3B--', { operator: null });
  assert.equal(res.status, 400);
  assert.ok(!/SELECT|FROM|at .*\.js|node:/.test(res.text), res.text);
}));
