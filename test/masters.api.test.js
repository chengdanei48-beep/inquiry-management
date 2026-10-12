import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp } from '../test-support/app.js';

// 担当者(社員ID 1〜3)・一般(4〜5)・無効な担当者(6)・無効な一般(7) / カテゴリ 1〜3 有効、4 無効 は test-support/app.js のとおり

/** 問い合わせを登録し、担当者を割り当てて対応中にする。 */
async function startWork(app, assigneeId, overrides = {}) {
  let d = await app.create(overrides);
  d = (await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId, updatedAt: d.updatedAt } })).body;
  d = (await app.api('POST', `/api/inquiries/${d.id}/status`, { body: { status: '対応中', updatedAt: d.updatedAt } })).body;
  return d;
}
async function complete(app, d) {
  return (await app.api('POST', `/api/inquiries/${d.id}/status`, {
    body: { status: '完了', resolution: '済', updatedAt: d.updatedAt },
  })).body;
}

// ---------- 社員 ----------

test('社員一覧: 全件と、担当者区分・有効で絞り込める', () => withApp(async (app) => {
  const all = await app.api('GET', '/api/employees', { operator: null });
  assert.equal(all.status, 200);
  assert.equal(all.body.items.length, 7);
  assert.deepEqual(all.body.items[0], { id: 1, name: '山田 太郎', department: '情報システム', isStaff: true, isActive: true });

  const ids = async (qs) => (await app.api('GET', `/api/employees?${qs}`, { operator: null })).body.items.map((e) => e.id);
  assert.deepEqual(await ids('staff=1&active=1'), [1, 2, 3]); // 画面の「操作する担当者」の選択肢
  assert.deepEqual(await ids('staff=1'), [1, 2, 3, 6]);
  assert.deepEqual(await ids('staff=0'), [4, 5, 7]);
  assert.deepEqual(await ids('active=0'), [6, 7]);
  assert.deepEqual(await ids('staff=1&active=0'), [6]);
}));

test('社員一覧: 不正な絞り込みは 400', () => withApp(async (app) => {
  for (const qs of ['staff=yes', 'active=2', 'staff=true']) {
    const res = await app.api('GET', `/api/employees?${qs}`, { operator: null });
    assert.equal(res.status, 400, qs);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
}));

test('社員追加: 201 で作成され、担当者区分は省略すると一般・有効', () => withApp(async (app) => {
  const res = await app.api('POST', '/api/employees', { body: { name: '  中村 次郎 ', department: '開発' } });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: 8, name: '中村 次郎', department: '開発', isStaff: false, isActive: true });
  const staff = await app.api('POST', '/api/employees', { body: { name: '新任 担当', department: '総務', isStaff: true } });
  assert.equal(staff.body.isStaff, true);
}));

test('社員追加: 50文字は受け付け、51文字・未入力・型違いは 400', () => withApp(async (app) => {
  const ok = await app.api('POST', '/api/employees', { body: { name: 'あ'.repeat(50), department: 'い'.repeat(50) } });
  assert.equal(ok.status, 201);
  const bad = await app.api('POST', '/api/employees', { body: { name: 'あ'.repeat(51), department: '', isStaff: 'yes' } });
  assert.equal(bad.status, 400);
  const fields = Object.fromEntries(bad.body.error.fields.map((f) => [f.field, f.message]));
  assert.equal(fields.name, '氏名は50文字以内で入力してください');
  assert.equal(fields.department, '部署を入力してください');
  assert.ok(fields.isStaff);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM employees').get().n, 8);
}));

test('社員: 変更系は操作者が必須(400 OPERATOR_REQUIRED)', () => withApp(async (app) => {
  for (const operator of [null, 4, 6]) {
    const post = await app.api('POST', '/api/employees', { body: { name: 'a', department: 'b' }, operator });
    assert.equal(post.status, 400);
    assert.equal(post.body.error.code, 'OPERATOR_REQUIRED');
    const patch = await app.api('PATCH', '/api/employees/4', { body: { name: 'c' }, operator });
    assert.equal(patch.body.error.code, 'OPERATOR_REQUIRED');
  }
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM employees').get().n, 7);
}));

test('社員編集: 指定した項目だけが更新される', () => withApp(async (app) => {
  const res = await app.api('PATCH', '/api/employees/5', { body: { department: '開発' } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { id: 5, name: '田中 健太', department: '開発', isStaff: false, isActive: true });
  const promote = await app.api('PATCH', '/api/employees/5', { body: { isStaff: true } });
  assert.equal(promote.body.isStaff, true);
}));

test('社員編集: 不正な入力・存在しないID・変更なしは 400 / 404', () => withApp(async (app) => {
  assert.equal((await app.api('PATCH', '/api/employees/5', { body: { name: 'あ'.repeat(51) } })).status, 400);
  assert.equal((await app.api('PATCH', '/api/employees/5', { body: { name: '' } })).status, 400);
  assert.equal((await app.api('PATCH', '/api/employees/5', { body: {} })).status, 400);
  assert.equal((await app.api('PATCH', '/api/employees/5', { body: { isActive: 'no' } })).status, 400);
  // null で意図せず担当者区分が外れないこと
  const nul = await app.api('PATCH', '/api/employees/1', { body: { isStaff: null } });
  assert.equal(nul.status, 400);
  assert.equal(app.db.prepare('SELECT is_staff FROM employees WHERE id = 1').get().is_staff, 1);
  for (const id of ['999', 'abc', '0']) {
    const res = await app.api('PATCH', `/api/employees/${id}`, { body: { name: 'x' } });
    assert.equal(res.status, 404, id);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  }
}));

test('社員の無効化: 未完了の担当案件があれば 409 HAS_OPEN_INQUIRIES で、変更されない', () => withApp(async (app) => {
  await startWork(app, 2); // 社員2が対応中の案件を持つ
  const res = await app.api('PATCH', '/api/employees/2', { body: { isActive: false } });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'HAS_OPEN_INQUIRIES');
  assert.equal(res.body.error.message, '未完了の問い合わせの担当者になっているため、無効にできません');
  assert.equal(app.db.prepare('SELECT is_active FROM employees WHERE id = 2').get().is_active, 1);
}));

test('社員の担当者区分: 未完了の担当案件があれば「一般」にできない(別の文言)', () => withApp(async (app) => {
  await startWork(app, 2);
  const res = await app.api('PATCH', '/api/employees/2', { body: { isStaff: false } });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'HAS_OPEN_INQUIRIES');
  assert.equal(res.body.error.message, '未完了の問い合わせの担当者になっているため、担当者区分を変更できません');
  // 氏名の変更は担当案件があってもできる
  const rename = await app.api('PATCH', '/api/employees/2', { body: { name: '佐藤 花子(改)' } });
  assert.equal(rename.status, 200);
}));

test('社員の無効化: 未対応(担当者割当済み)・保留も未完了として拒否し、完了後は無効化できる', () => withApp(async (app) => {
  // 未対応のまま担当者だけ割り当てた案件
  let a = await app.create();
  a = (await app.api('POST', `/api/inquiries/${a.id}/assignee`, { body: { assigneeId: 3, updatedAt: a.updatedAt } })).body;
  assert.equal(a.status, '未対応');
  const r1 = await app.api('PATCH', '/api/employees/3', { body: { isActive: false } });
  assert.equal(r1.status, 409);

  // 保留
  a = (await app.api('POST', `/api/inquiries/${a.id}/status`, { body: { status: '対応中', updatedAt: a.updatedAt } })).body;
  a = (await app.api('POST', `/api/inquiries/${a.id}/status`, { body: { status: '保留', updatedAt: a.updatedAt } })).body;
  assert.equal((await app.api('PATCH', '/api/employees/3', { body: { isActive: false } })).status, 409);

  // 対応中に戻して完了 → 無効化できる
  a = (await app.api('POST', `/api/inquiries/${a.id}/status`, { body: { status: '対応中', updatedAt: a.updatedAt } })).body;
  await complete(app, a);
  const ok = await app.api('PATCH', '/api/employees/3', { body: { isActive: false } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.isActive, false);
}));

test('社員の無効化: 担当案件が無い社員や、担当者でない社員は無効化・再有効化できる', () => withApp(async (app) => {
  const off = await app.api('PATCH', '/api/employees/4', { body: { isActive: false } });
  assert.equal(off.status, 200);
  const on = await app.api('PATCH', '/api/employees/4', { body: { isActive: true } });
  assert.equal(on.status, 200);
  assert.equal(on.body.isActive, true);
  // すでに無効な担当者を、再度「無効」にするのは問題なし(状態は変わらない)
  assert.equal((await app.api('PATCH', '/api/employees/6', { body: { isActive: false } })).status, 200);
}));

test('社員の無効化: 無効にした社員は、依頼者・担当者・操作者として使えない', () => withApp(async (app) => {
  await app.api('PATCH', '/api/employees/5', { body: { isActive: false } }); // 依頼者として使っていた一般社員
  const create = await app.api('POST', '/api/inquiries', { body: app.validInquiry }); // requesterId 5
  assert.equal(create.status, 400);
  assert.equal(create.body.error.fields[0].field, 'requesterId');

  await app.api('PATCH', '/api/employees/2', { body: { isActive: false } });
  const d = await app.create({ requesterId: 4 }); // 依頼者5は無効にしたため、別の社員を使う
  const assign = await app.api('POST', `/api/inquiries/${d.id}/assignee`, { body: { assigneeId: 2, updatedAt: d.updatedAt } });
  assert.equal(assign.status, 400);
  const asOperator = await app.api('POST', '/api/inquiries', { body: app.validInquiry, operator: 2 });
  assert.equal(asOperator.body.error.code, 'OPERATOR_REQUIRED');
}));

test('社員の無効化: 過去の問い合わせには、無効にした依頼者・担当者が引き続き表示される', () => withApp(async (app) => {
  const d = await startWork(app, 1);
  await complete(app, d);
  await app.api('PATCH', '/api/employees/1', { body: { isActive: false } });
  await app.api('PATCH', '/api/employees/5', { body: { isActive: false } });
  const res = await app.api('GET', `/api/inquiries/${d.id}`, { operator: null });
  assert.equal(res.body.assignee.name, '山田 太郎');
  assert.equal(res.body.requester.name, '田中 健太');
}));

// ---------- カテゴリ ----------

test('カテゴリ一覧: 表示順で返り、有効で絞り込める', () => withApp(async (app) => {
  const all = await app.api('GET', '/api/categories', { operator: null });
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.items.map((c) => c.id), [1, 2, 3, 4]);
  assert.deepEqual(all.body.items[0], { id: 1, name: 'PC・ネットワーク', sortOrder: 1, isActive: true });
  const active = await app.api('GET', '/api/categories?active=1', { operator: null });
  assert.deepEqual(active.body.items.map((c) => c.id), [1, 2, 3]);
  assert.equal((await app.api('GET', '/api/categories?active=maybe', { operator: null })).status, 400);
}));

test('カテゴリ追加: 201 で作成され、表示順に反映される', () => withApp(async (app) => {
  const res = await app.api('POST', '/api/categories', { body: { name: ' その他 ', sortOrder: 0 } });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: 5, name: 'その他', sortOrder: 0, isActive: true });
  const list = await app.api('GET', '/api/categories', { operator: null });
  assert.equal(list.body.items[0].name, 'その他'); // 表示順 0 が先頭
}));

test('カテゴリ追加: 名称の重複(無効なものを含む)は 409 DUPLICATE_NAME', () => withApp(async (app) => {
  for (const name of ['PC・ネットワーク', '廃止カテゴリ']) { // 有効・無効
    const res = await app.api('POST', '/api/categories', { body: { name, sortOrder: 9 } });
    assert.equal(res.status, 409, name);
    assert.equal(res.body.error.code, 'DUPLICATE_NAME');
  }
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM categories').get().n, 4);
}));

test('カテゴリ追加: 50文字は受け付け、51文字・未入力・不正な表示順は 400', () => withApp(async (app) => {
  assert.equal((await app.api('POST', '/api/categories', { body: { name: 'あ'.repeat(50), sortOrder: 9 } })).status, 201);
  const bad = await app.api('POST', '/api/categories', { body: { name: 'あ'.repeat(51), sortOrder: -1 } });
  assert.equal(bad.status, 400);
  const fields = Object.fromEntries(bad.body.error.fields.map((f) => [f.field, f.message]));
  assert.equal(fields.name, '名称は50文字以内で入力してください');
  assert.equal(fields.sortOrder, '表示順は0以上の整数で入力してください');
  assert.equal((await app.api('POST', '/api/categories', { body: { name: 'x' } })).status, 400);
  assert.equal((await app.api('POST', '/api/categories', { body: { name: 'x', sortOrder: 1 }, operator: null })).status, 400);
}));

test('カテゴリ編集: 名称・表示順・有効を変更でき、自分自身と同じ名称は重複にならない', () => withApp(async (app) => {
  const same = await app.api('PATCH', '/api/categories/1', { body: { name: 'PC・ネットワーク', sortOrder: 10 } });
  assert.equal(same.status, 200);
  assert.equal(same.body.sortOrder, 10);
  const rename = await app.api('PATCH', '/api/categories/2', { body: { name: 'アカウント' } });
  assert.equal(rename.body.name, 'アカウント');
  const list = await app.api('GET', '/api/categories', { operator: null });
  assert.deepEqual(list.body.items.map((c) => c.id), [2, 3, 4, 1]); // 表示順 2,3,4,10
}));

test('カテゴリ編集: 他のカテゴリと同じ名称は 409、存在しないID・不正入力は 404 / 400', () => withApp(async (app) => {
  const dup = await app.api('PATCH', '/api/categories/1', { body: { name: 'アカウント・権限' } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'DUPLICATE_NAME');
  assert.equal(app.db.prepare('SELECT name FROM categories WHERE id = 1').get().name, 'PC・ネットワーク');
  assert.equal((await app.api('PATCH', '/api/categories/999', { body: { name: 'x' } })).status, 404);
  assert.equal((await app.api('PATCH', '/api/categories/abc', { body: { name: 'x' } })).status, 404);
  assert.equal((await app.api('PATCH', '/api/categories/1', { body: {} })).status, 400);
  assert.equal((await app.api('PATCH', '/api/categories/1', { body: { name: 'あ'.repeat(51) } })).status, 400);
  assert.equal((await app.api('PATCH', '/api/categories/1', { body: { sortOrder: 'x' } })).status, 400);
  assert.equal((await app.api('PATCH', '/api/categories/1', { body: { isActive: null } })).status, 400);
}));

test('カテゴリの無効化: 使用中でもできる。新規の問い合わせでは選べず、過去の問い合わせには表示される', () => withApp(async (app) => {
  const d = await app.create({ categoryId: 3 });
  const off = await app.api('PATCH', '/api/categories/3', { body: { isActive: false } });
  assert.equal(off.status, 200);
  assert.equal(off.body.isActive, false);

  const create = await app.api('POST', '/api/inquiries', { body: { ...app.validInquiry, categoryId: 3 } });
  assert.equal(create.status, 400);
  assert.equal(create.body.error.fields[0].field, 'categoryId');

  const detail = await app.api('GET', `/api/inquiries/${d.id}`, { operator: null });
  assert.equal(detail.body.category.name, '備品・ソフト申請');

  // 再度有効にすれば選べる
  await app.api('PATCH', '/api/categories/3', { body: { isActive: true } });
  assert.equal((await app.api('POST', '/api/inquiries', { body: { ...app.validInquiry, categoryId: 3 } })).status, 201);
}));

test('削除APIは無い(DELETE は 404)', () => withApp(async (app) => {
  assert.equal((await app.api('DELETE', '/api/employees/1')).status, 404);
  assert.equal((await app.api('DELETE', '/api/categories/1')).status, 404);
  assert.equal((await app.api('DELETE', '/api/inquiries/1')).status, 404);
}));
