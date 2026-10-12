import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.js';
import { ensureInitialCategories, INITIAL_CATEGORIES } from '../src/db/initial.js';
import { anchorMonday, buildInquiry, SAMPLE_INQUIRIES, seedDatabase } from '../src/seed.js';
import { workMinutes } from '../src/domain/time.js';
import { buildSummary } from '../src/repo/reports.js';
import { startTestApp, withApp } from '../test-support/app.js';

// 基準日は、実行日の「前の週の月曜日」が決まる。2026-10-12(月)なら、前の週の月曜日は 2026-10-05。
const NOW = new Date(2026, 9, 12, 10, 0, 0);
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);

function seeded(now = NOW) {
  const db = openDatabase(':memory:');
  const result = seedDatabase(db, { now });
  return { db, result };
}

test('初期カテゴリ: 空のときだけ5種を作成し、2回目は何もしない', () => {
  const db = openDatabase(':memory:');
  assert.equal(ensureInitialCategories(db), 5);
  assert.deepEqual(
    db.prepare('SELECT name, sort_order FROM categories ORDER BY sort_order').all().map((r) => [r.name, r.sort_order]),
    INITIAL_CATEGORIES.map((n, i) => [n, i + 1]),
  );
  assert.equal(ensureInitialCategories(db), 0);
  // 1件でもあれば作成しない
  const other = openDatabase(':memory:');
  other.prepare("INSERT INTO categories (name, sort_order) VALUES ('独自', 1)").run();
  assert.equal(ensureInitialCategories(other), 0);
  assert.equal(other.prepare('SELECT count(*) AS n FROM categories').get().n, 1);
});

test('投入: 社員10名(担当者3名)、問い合わせ15件、履歴、カテゴリ5種', () => {
  const { db, result } = seeded();
  assert.deepEqual(result, { seeded: true, employees: 10, inquiries: 15 });
  assert.equal(db.prepare('SELECT count(*) AS n FROM employees').get().n, 10);
  assert.equal(db.prepare('SELECT count(*) AS n FROM employees WHERE is_staff = 1').get().n, 3);
  assert.equal(db.prepare('SELECT count(*) AS n FROM inquiries').get().n, 15);
  assert.equal(db.prepare('SELECT count(*) AS n FROM categories').get().n, 5);
  // どの問い合わせにも「登録」の履歴がある
  const withoutRegistered = db.prepare(`SELECT count(*) AS n FROM inquiries i
    WHERE NOT EXISTS (SELECT 1 FROM inquiry_histories h WHERE h.inquiry_id = i.id AND h.type = 'registered')`).get().n;
  assert.equal(withoutRegistered, 0);
});

test('投入: ステータスが混在し、カテゴリ・部署に偏りがある(グラフに差が出る)', () => {
  const { db } = seeded();
  const status = Object.fromEntries(
    db.prepare('SELECT status, count(*) AS n FROM inquiries GROUP BY status').all().map((r) => [r.status, r.n]),
  );
  assert.deepEqual(status, { 完了: 10, 対応中: 2, 保留: 1, 未対応: 2 });

  const s = buildSummary(db, '2000-01-01', '2100-12-31');
  assert.deepEqual(s.a01.map((r) => r.count), [5, 3, 4, 2, 1]);
  assert.deepEqual(
    s.a02.map((r) => [r.dept, r.count]),
    [['営業', 5], ['開発', 4], ['人事', 3], ['総務', 3], ['情報システム', 0]],
  );
  assert.ok(new Set(s.a01.map((r) => r.count)).size >= 4, 'カテゴリ別の件数に差がない');
  // 月別推移(4か月以上に分散し、月ごとに件数が違う)
  assert.ok(s.a05.length >= 4);
  assert.ok(new Set(s.a05.map((r) => r.count)).size >= 2);
  // 未割当の未完了(2件)も担当者別に出る
  assert.deepEqual(s.a04.at(-1), { assignee: '未割当', done: 0, open: 2 });
});

test('投入: 保存された対応時間は、履歴から設計書の計算で求めた値と一致する', () => {
  const { db } = seeded();
  const rows = db.prepare("SELECT id, received_at, completed_at, work_minutes FROM inquiries WHERE status = '完了'").all();
  assert.equal(rows.length, 10);
  for (const r of rows) {
    const histories = db
      .prepare("SELECT type, from_status, to_status, at FROM inquiry_histories WHERE inquiry_id = ? AND type = 'status' ORDER BY at, id")
      .all(r.id);
    const expected = workMinutes({ receivedAt: r.received_at, completedAt: r.completed_at, histories });
    assert.equal(r.work_minutes, expected, `#${r.id}`);
  }
});

test('投入: 対応時間の確認用の例(設計書の 450分、営業時間外・土日をまたぐ例、保留を挟む例)', () => {
  const { db } = seeded();
  const minutes = (title) => db.prepare('SELECT work_minutes AS m FROM inquiries WHERE title = ?').get(title).m;
  assert.equal(minutes('ソフトのインストール申請'), 450); // 金 16:30 受付、月 9:00〜13:00 保留、火 10:00 完了 = 7:30
  assert.equal(minutes('共有フォルダに入れない'), 60); // 木 17:30 受付 → 金 9:30 完了(営業時間外をまたぐ)
  assert.equal(minutes('プリンターが印刷できない'), 90); // 金 16:50 受付 → 月 9:20 完了(土日をまたぐ)
  assert.equal(minutes('モニターの追加申請'), 570); // 保留(火 10:00〜木 10:00)を除く
  assert.equal(minutes('パスワードを忘れた'), 40);
  // 保留を経験した問い合わせの数
  const holds = db
    .prepare("SELECT count(DISTINCT inquiry_id) AS n FROM inquiry_histories WHERE type = 'status' AND to_status = '保留'")
    .get().n;
  assert.equal(holds, 3); // 完了した2件(ソフト・モニター)+ 現在保留中の1件
});

test('投入: 履歴は日時順で、ステータス変更の前後が連続している', () => {
  const { db } = seeded();
  const ids = db.prepare('SELECT id FROM inquiries').all().map((r) => r.id);
  for (const id of ids) {
    const hs = db.prepare('SELECT * FROM inquiry_histories WHERE inquiry_id = ? ORDER BY id').all(id);
    assert.equal(hs[0].type, 'registered');
    for (let i = 1; i < hs.length; i += 1) assert.ok(hs[i].at >= hs[i - 1].at, `#${id} の履歴の時刻が逆転`);
    let current = '未対応';
    for (const h of hs.filter((x) => x.type === 'status')) {
      assert.equal(h.from_status, current, `#${id} のステータスの前後が不連続`);
      current = h.to_status;
    }
    assert.equal(current, db.prepare('SELECT status FROM inquiries WHERE id = ?').get(id).status);
  }
});

test('投入: 関連する問い合わせ、担当者(担当者区分の社員のみ)、更新日時', () => {
  const { db } = seeded();
  const related = db.prepare(`SELECT i.title, r.title AS related FROM inquiries i
    JOIN inquiries r ON r.id = i.related_inquiry_id`).all();
  assert.deepEqual(related.map((r) => ({ ...r })), [{ title: '権限の変更申請', related: 'パスワードを忘れた' }]);
  const nonStaffAssignee = db.prepare(`SELECT count(*) AS n FROM inquiries i
    JOIN employees e ON e.id = i.assignee_id WHERE e.is_staff = 0`).get().n;
  assert.equal(nonStaffAssignee, 0);
  // 更新日時 = 最後のステータス変更・担当者変更の日時(コメントでは変わらない)
  const row = db.prepare("SELECT id, updated_at FROM inquiries WHERE title = 'VPNに接続できない'").get();
  const lastChange = db
    .prepare("SELECT max(at) AS at FROM inquiry_histories WHERE inquiry_id = ? AND type IN ('assignee', 'status', 'registered')")
    .get(row.id).at;
  const lastComment = db
    .prepare("SELECT max(at) AS at FROM inquiry_histories WHERE inquiry_id = ? AND type = 'comment'")
    .get(row.id).at;
  assert.equal(row.updated_at, lastChange);
  assert.ok(lastComment > row.updated_at);
});

test('日付: すべて過去で、直近約3〜4か月に収まる', () => {
  const { db } = seeded();
  const first = db.prepare('SELECT min(received_at) AS v FROM inquiries').get().v;
  const last = db.prepare('SELECT max(at) AS v FROM inquiry_histories').get().v;
  assert.ok(last < '2026-10-12 10:00:00.000', `未来の日時がある: ${last}`);
  assert.ok(first >= '2026-06-15', `古すぎる: ${first}`);
  assert.ok(first <= '2026-07-15', `新しすぎる(3か月に満たない): ${first}`);
});

test('日付: どの日に実行しても、未来の日時が入らず、対応時間の例が保たれる', () => {
  // 月曜 0:00 / 日曜 23:59 / 月初 / 年末 / 年始 / うるう日 / 半年後
  const dates = [
    new Date(2026, 9, 12, 0, 0, 0), new Date(2026, 9, 11, 23, 59, 59), new Date(2026, 10, 1, 9, 0, 0),
    new Date(2026, 11, 31, 12, 0, 0), new Date(2027, 0, 4, 8, 0, 0), new Date(2028, 1, 29, 12, 0, 0),
    new Date(2027, 5, 15, 12, 0, 0),
  ];
  const pad = (n) => String(n).padStart(2, '0');
  for (const now of dates) {
    const { db } = seeded(now);
    const nowText = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
      + `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.000`;
    const last = db.prepare('SELECT max(at) AS v FROM inquiry_histories').get().v;
    assert.ok(last <= nowText, `${nowText} に対して未来: ${last}`);
    const minutes = (title) => db.prepare('SELECT work_minutes AS m FROM inquiries WHERE title = ?').get(title).m;
    assert.equal(minutes('ソフトのインストール申請'), 450, nowText);
    assert.equal(minutes('プリンターが印刷できない'), 90, nowText);
    // 受付の曜日が、実行日によらず同じ(例は金曜に受付)
    const received = db.prepare("SELECT received_at AS v FROM inquiries WHERE title = 'ソフトのインストール申請'").get().v;
    assert.equal(new Date(`${received.slice(0, 10)}T00:00:00Z`).getUTCDay(), 5, nowText);
  }
});

test('基準日: 前の週の月曜日', () => {
  assert.equal(fmt(anchorMonday(new Date(2026, 9, 12))), '2026-10-05'); // 月曜
  assert.equal(fmt(anchorMonday(new Date(2026, 9, 18))), '2026-10-05'); // 日曜(同じ週)
  assert.equal(fmt(anchorMonday(new Date(2026, 9, 14))), '2026-10-05'); // 水曜
  assert.equal(fmt(anchorMonday(new Date(2026, 9, 19))), '2026-10-12'); // 次の月曜
  assert.equal(fmt(anchorMonday(new Date(2027, 0, 1))), '2026-12-21'); // 年またぎ
});

test('投入: 2回目は何もしない。社員または問い合わせが既にあれば投入しない', () => {
  const { db } = seeded();
  assert.deepEqual(seedDatabase(db, { now: NOW }), { seeded: false, employees: 0, inquiries: 0 });
  assert.equal(db.prepare('SELECT count(*) AS n FROM inquiries').get().n, 15);
  assert.equal(db.prepare('SELECT count(*) AS n FROM employees').get().n, 10);

  const withEmployee = openDatabase(':memory:');
  withEmployee.prepare("INSERT INTO employees (name, department, is_staff) VALUES ('既存', '総務', 1)").run();
  assert.equal(seedDatabase(withEmployee, { now: NOW }).seeded, false);
  assert.equal(withEmployee.prepare('SELECT count(*) AS n FROM employees').get().n, 1);
  assert.equal(withEmployee.prepare('SELECT count(*) AS n FROM inquiries').get().n, 0);
});

test('投入: 初期カテゴリだけがあるDB(アプリを起動済み)にも投入できる', () => {
  const db = openDatabase(':memory:');
  ensureInitialCategories(db);
  assert.equal(seedDatabase(db, { now: NOW }).seeded, true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM categories').get().n, 5); // 重複して作らない
});

test('投入: カテゴリを一部しか持たないDBでは、足りないカテゴリを末尾に追加する', () => {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO categories (name, sort_order) VALUES ('PC・ネットワーク', 1)").run();
  assert.equal(seedDatabase(db, { now: NOW }).seeded, true);
  const names = db.prepare('SELECT name FROM categories ORDER BY sort_order').all().map((r) => r.name);
  assert.equal(names[0], 'PC・ネットワーク');
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('その他'));
});

test('投入: 途中で失敗したら、何も残らない(トランザクション)', () => {
  const db = openDatabase(':memory:');
  // 履歴の挿入を失敗させる
  db.exec("CREATE TRIGGER fail_on_insert BEFORE INSERT ON inquiry_histories BEGIN SELECT RAISE(ABORT, 'テスト用の失敗'); END;");
  assert.throws(() => seedDatabase(db, { now: NOW }), /テスト用の失敗/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM employees').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM inquiries').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM categories').get().n, 0);
});

test('データ定義: 手順の誤り(担当者の割当前のステータス変更・時刻の逆転など)は例外にする', () => {
  const anchor = anchorMonday(NOW);
  const base = {
    title: 't', body: 'b', requester: '田中 健太', category: 'その他', priority: '中',
    assignee: '山田 太郎', registered: [-1, 0, '09:00'],
  };
  assert.throws(() => buildInquiry({ ...base, steps: [['status', '対応中', [-1, 0, '09:10']]] }, anchor), /担当者の割当前/);
  assert.throws(() => buildInquiry({ ...base, steps: [['assign', [-1, 0, '08:00']]] }, anchor), /逆転/);
  assert.throws(
    () => buildInquiry({ ...base, steps: [['assign', [-1, 0, '09:05']], ['status', '完了', [-1, 0, '09:10']]] }, anchor),
    /対応内容/,
  );
  assert.throws(() => buildInquiry({ ...base, steps: [['unknown', [-1, 0, '09:05']]] }, anchor), /不明な手順/);
});

test('データ定義: 15件で、件名が重複せず、50文字以内', () => {
  assert.equal(SAMPLE_INQUIRIES.length, 15);
  assert.equal(new Set(SAMPLE_INQUIRIES.map((i) => i.title)).size, 15);
  for (const i of SAMPLE_INQUIRIES) assert.ok([...i.title].length <= 50 && [...i.body].length <= 50);
});

test('API: 投入したデータが、一覧・詳細・CSV・操作者の選択肢から使える', () => withApp(async (app) => {
  seedDatabase(app.db, { now: NOW });
  const list = await app.api('GET', '/api/inquiries', { operator: null });
  assert.equal(list.body.total, 15);
  const ongoing = await app.api('GET', `/api/inquiries?status=${encodeURIComponent('対応中')}`, { operator: null });
  assert.equal(ongoing.body.total, 2);
  const detail = await app.api('GET', `/api/inquiries/${list.body.items[0].id}`, { operator: null });
  assert.equal(detail.status, 200);
  assert.ok(detail.body.histories.length >= 1);
  const csv = await app.api('GET', '/api/inquiries/export.csv', { operator: null });
  assert.equal(csv.text.slice(1).trimEnd().split('\r\n').length, 16);
  const operators = await app.api('GET', '/api/employees?staff=1&active=1', { operator: null });
  assert.equal(operators.body.items.length, 3);
}, { masters: false }));

test('API: 投入したデータの問い合わせを、担当者として操作できる', () => withApp(async (app) => {
  seedDatabase(app.db, { now: NOW });
  const item = (await app.api('GET', `/api/inquiries?status=${encodeURIComponent('未対応')}`, { operator: null })).body.items[0];
  const d = (await app.api('GET', `/api/inquiries/${item.id}`, { operator: null })).body;
  const operator = (await app.api('GET', '/api/employees?staff=1&active=1', { operator: null })).body.items[0].id;
  const res = await app.api('POST', `/api/inquiries/${d.id}/assignee`, {
    body: { assigneeId: operator, updatedAt: d.updatedAt }, operator,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.assignee.id, operator);
}, { masters: false }));

test('初期セットアップ: 担当者が1人もいない間だけ、操作者なしで社員を追加できる', async () => {
  const app = await startTestApp({ masters: false });
  try {
    const first = await app.api('POST', '/api/employees', {
      body: { name: '初代 担当', department: '情報システム', isStaff: true }, operator: null,
    });
    assert.equal(first.status, 201);
    assert.equal(first.body.isStaff, true);
    // 担当者ができた後は、操作者が必須
    const noOperator = await app.api('POST', '/api/employees', { body: { name: '二人目', department: '総務' }, operator: null });
    assert.equal(noOperator.status, 400);
    assert.equal(noOperator.body.error.code, 'OPERATOR_REQUIRED');
    const withOperator = await app.api('POST', '/api/employees', {
      body: { name: '二人目', department: '総務' }, operator: first.body.id,
    });
    assert.equal(withOperator.status, 201);
  } finally {
    await app.close();
  }
});

test('初期セットアップ: 担当者以外だけを追加した間は操作者なしで追加できる。入力検証は行い、他の変更系は使えない', async () => {
  const app = await startTestApp({ masters: false });
  try {
    const general = await app.api('POST', '/api/employees', { body: { name: '一般 社員', department: '営業' }, operator: null });
    assert.equal(general.status, 201);
    assert.equal(general.body.isStaff, false);
    const invalid = await app.api('POST', '/api/employees', { body: { name: '', department: '営業' }, operator: null });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
    // 社員の編集など、他の変更系は操作者が必要(担当者がいなければ使えない)
    const patch = await app.api('PATCH', `/api/employees/${general.body.id}`, { body: { isStaff: true }, operator: null });
    assert.equal(patch.status, 400);
    assert.equal(patch.body.error.code, 'OPERATOR_REQUIRED');
  } finally {
    await app.close();
  }
});

test('初期セットアップ: 有効な担当者が全員いなくなったら、再び操作者なしで追加できる(復旧用)', async () => {
  const app = await startTestApp({ masters: false });
  try {
    const staff = await app.api('POST', '/api/employees', {
      body: { name: '担当 者', department: '情報システム', isStaff: true }, operator: null,
    });
    app.db.prepare('UPDATE employees SET is_active = 0 WHERE id = ?').run(staff.body.id);
    const again = await app.api('POST', '/api/employees', {
      body: { name: '復旧 担当', department: '情報システム', isStaff: true }, operator: null,
    });
    assert.equal(again.status, 201);
  } finally {
    await app.close();
  }
});
