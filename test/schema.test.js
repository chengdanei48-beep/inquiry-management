import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/index.js';
import { SCHEMA_VERSION } from '../src/db/schema.js';

const T = '2026-10-12 09:30:00.000';

function setup() {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO employees (name, department, is_staff) VALUES ('山田 太郎', '情報システム', 1)").run();
  db.prepare("INSERT INTO employees (name, department, is_staff) VALUES ('田中 健太', '営業', 0)").run();
  db.prepare("INSERT INTO categories (name, sort_order) VALUES ('PC・ネットワーク', 1)").run();
  return db;
}

// 既定値を持つ問い合わせを1件登録する。overrides で列を上書きする。
function insertInquiry(db, overrides = {}) {
  const row = {
    title: 'VPNに接続できない', body: '在宅勤務で接続不可', requester_id: 2, category_id: 1,
    priority: '高', status: '未対応', assignee_id: null, related_inquiry_id: null,
    resolution: null, received_at: T, updated_at: T, completed_at: null, work_minutes: null,
    ...overrides,
  };
  const cols = Object.keys(row);
  return db
    .prepare(`INSERT INTO inquiries (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c]));
}

test('初期化: 版・外部キー・テーブルが作られる', () => {
  const db = openDatabase(':memory:');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all().map((r) => r.name).sort();
  assert.deepEqual(tables, ['categories', 'employees', 'inquiries', 'inquiry_histories']);
});

test('初期化: 既存のDBファイルを開き直してもデータが残り、版も変わらない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inq-'));
  const file = path.join(dir, 'sub', 'test.db'); // 親ディレクトリが無くても作られる
  try {
    const db1 = openDatabase(file);
    db1.prepare("INSERT INTO categories (name, sort_order) VALUES ('その他', 5)").run();
    db1.close();
    const db2 = openDatabase(file);
    assert.equal(db2.prepare('SELECT count(*) AS n FROM categories').get().n, 1);
    assert.equal(db2.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    db2.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('初期化: アプリより新しい版のDBは開けない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inq-'));
  const file = path.join(dir, 'new.db');
  try {
    const db = openDatabase(file);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    db.close();
    assert.throws(() => openDatabase(file), /新しいです/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('問い合わせ: 正常な登録ができる', () => {
  const db = setup();
  assert.doesNotThrow(() => insertInquiry(db));
});

test('文字数: 50文字は登録でき、51文字と空白のみは拒否される', () => {
  const db = setup();
  assert.doesNotThrow(() => insertInquiry(db, { title: 'あ'.repeat(50) }));
  assert.throws(() => insertInquiry(db, { title: 'あ'.repeat(51) }), /CHECK/);
  assert.throws(() => insertInquiry(db, { title: '   ' }), /CHECK/);
  assert.throws(() => insertInquiry(db, { body: '' }), /CHECK/);
});

test('文字数: 社員・カテゴリの名称も50文字以内', () => {
  const db = setup();
  assert.throws(() => db.prepare("INSERT INTO employees (name, department) VALUES (?, '総務')").run('あ'.repeat(51)), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO categories (name, sort_order) VALUES (?, 9)").run('あ'.repeat(51)), /CHECK/);
});

test('選択肢: 優先度・ステータスの範囲外は拒否される', () => {
  const db = setup();
  assert.throws(() => insertInquiry(db, { priority: '最高' }), /CHECK/);
  assert.throws(() => insertInquiry(db, { status: '削除' }), /CHECK/);
});

test('担当者: 未対応以外のステータスでは担当者が必須', () => {
  const db = setup();
  assert.doesNotThrow(() => insertInquiry(db, { status: '未対応', assignee_id: null }));
  assert.throws(() => insertInquiry(db, { status: '対応中', assignee_id: null }), /CHECK/);
  assert.doesNotThrow(() => insertInquiry(db, { status: '対応中', assignee_id: 1 }));
  assert.doesNotThrow(() => insertInquiry(db, { status: '保留', assignee_id: 1 }));
});

test('完了: 対応内容・完了日時・対応時間は完了のときだけ必須で、完了以外では空', () => {
  const db = setup();
  const done = { status: '完了', assignee_id: 1, resolution: 'パスワードを再発行した', completed_at: T, work_minutes: 40 };
  assert.doesNotThrow(() => insertInquiry(db, done));
  assert.throws(() => insertInquiry(db, { ...done, resolution: null }), /CHECK/);
  assert.throws(() => insertInquiry(db, { ...done, completed_at: null }), /CHECK/);
  assert.throws(() => insertInquiry(db, { ...done, work_minutes: null }), /CHECK/);
  // 完了以外で完了関連の列があるのは不整合
  assert.throws(() => insertInquiry(db, { status: '対応中', assignee_id: 1, completed_at: T }), /CHECK/);
  assert.throws(() => insertInquiry(db, { status: '対応中', assignee_id: 1, resolution: '済' }), /CHECK/);
  assert.throws(() => insertInquiry(db, { ...done, work_minutes: -1 }), /CHECK/);
});

test('関連する問い合わせ: 自分自身は指せず、存在しないIDも拒否される', () => {
  const db = setup();
  insertInquiry(db); // id = 1
  assert.doesNotThrow(() => insertInquiry(db, { related_inquiry_id: 1 }));
  assert.throws(() => db.prepare('UPDATE inquiries SET related_inquiry_id = id WHERE id = 1').run(), /CHECK/);
  assert.throws(() => insertInquiry(db, { related_inquiry_id: 999 }), /FOREIGN KEY/);
});

test('外部キー: 存在しない依頼者・カテゴリ・担当者は拒否される', () => {
  const db = setup();
  assert.throws(() => insertInquiry(db, { requester_id: 999 }), /FOREIGN KEY/);
  assert.throws(() => insertInquiry(db, { category_id: 999 }), /FOREIGN KEY/);
  assert.throws(() => insertInquiry(db, { status: '対応中', assignee_id: 999 }), /FOREIGN KEY/);
});

test('日時: 形式が違う値は拒否される', () => {
  const db = setup();
  assert.throws(() => insertInquiry(db, { received_at: '2026/10/12 09:30' }), /CHECK/);
  assert.throws(() => insertInquiry(db, { updated_at: '2026-10-12T09:30:00.000' }), /CHECK/);
});

test('カテゴリ: 名称は重複できない', () => {
  const db = setup();
  assert.throws(() => db.prepare("INSERT INTO categories (name, sort_order) VALUES ('PC・ネットワーク', 2)").run(), /UNIQUE/);
});

test('履歴: 種別の範囲外、ステータス変更の前後欠落、空のコメントは拒否される', () => {
  const db = setup();
  insertInquiry(db);
  const insert = (type, from, to, content) => db
    .prepare('INSERT INTO inquiry_histories (inquiry_id, type, from_status, to_status, content, operator_id, at) VALUES (1, ?, ?, ?, ?, 1, ?)')
    .run(type, from, to, content, T);
  assert.doesNotThrow(() => insert('registered', null, null, null));
  assert.doesNotThrow(() => insert('status', '未対応', '対応中', null));
  assert.doesNotThrow(() => insert('comment', null, null, '再起動を依頼した'));
  assert.throws(() => insert('unknown', null, null, null), /CHECK/);
  assert.throws(() => insert('status', null, '対応中', null), /CHECK/);
  assert.throws(() => insert('comment', null, null, ''), /CHECK/);
  assert.throws(() => insert('comment', null, null, 'あ'.repeat(51)), /CHECK/);
});

test('索引: 設計書の索引が作られている', () => {
  const db = openDatabase(':memory:');
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")
    .all().map((r) => r.name).sort();
  assert.deepEqual(names, [
    'idx_histories_inquiry_at', 'idx_inquiries_assignee', 'idx_inquiries_category',
    'idx_inquiries_received', 'idx_inquiries_status',
  ]);
});
