// 性能(要件定義書 7章「数千件規模の問い合わせで、一覧・集計が体感で待たされない(目安: 1秒以内)」)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../test-support/app.js';

const COUNT = 5000;
const LIMIT_MS = 1000;

/** 5,000件の問い合わせ(履歴つき)を直接登録する。 */
function seedMany(db) {
  const statuses = ['未対応', '対応中', '保留', '完了', '完了', '完了'];
  const insert = db.prepare(`INSERT INTO inquiries
    (title, body, requester_id, category_id, priority, status, assignee_id, resolution,
     received_at, updated_at, completed_at, work_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const history = db.prepare(`INSERT INTO inquiry_histories
    (inquiry_id, type, from_status, to_status, content, operator_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const pad = (n) => String(n).padStart(2, '0');
  db.exec('BEGIN');
  for (let i = 0; i < COUNT; i += 1) {
    const status = statuses[i % statuses.length];
    const done = status === '完了';
    const day = 1 + (i % 28);
    const month = 1 + (i % 12);
    const at = `2026-${pad(month)}-${pad(day)} ${pad(9 + (i % 9))}:${pad(i % 60)}:00.000`;
    const assignee = status === '未対応' ? null : 1 + (i % 3);
    const id = Number(insert.run(
      `問い合わせ${i} VPN接続`, `内容${i}`, 4 + (i % 2), 1 + (i % 3), ['高', '中', '低'][i % 3], status, assignee,
      done ? '対応した' : null, at, at, done ? at : null, done ? 30 + (i % 600) : null,
    ).lastInsertRowid);
    history.run(id, 'registered', null, null, '問い合わせを登録しました', 1, at);
    if (assignee) history.run(id, 'assignee', null, null, '担当者を設定', 1, at);
    if (done) history.run(id, 'status', '対応中', '完了', '対応した', assignee, at);
  }
  db.exec('COMMIT');
}

async function timed(label, fn, t) {
  const start = process.hrtime.bigint();
  const result = await fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  t.diagnostic(`${label}: ${ms.toFixed(0)} ms`);
  assert.ok(ms < LIMIT_MS, `${label} が ${ms.toFixed(0)} ms かかった(目安 ${LIMIT_MS} ms 以内)`);
  return result;
}

test(`性能: ${COUNT}件の問い合わせで、一覧・検索・集計・CSVが1秒以内に返る`, async (t) => {
  const app = await startTestApp();
  try {
    seedMany(app.db);
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM inquiries').get().n, COUNT);
    const get = (url) => app.api('GET', url, { operator: null });

    const list = await timed('一覧(1ページ目)', () => get('/api/inquiries'), t);
    assert.equal(list.body.total, COUNT);
    assert.equal(list.body.items.length, 20);

    await timed('一覧(最終ページ)', () => get(`/api/inquiries?page=${COUNT / 20}`), t);
    await timed('一覧(ステータスとカテゴリで絞り込み)', () => get(`/api/inquiries?status=${encodeURIComponent('完了')}&categoryId=1`), t);
    await timed('一覧(優先度順)', () => get('/api/inquiries?sort=priority&dir=asc'), t);

    const search = await timed('一覧(キーワード検索)', () => get(`/api/inquiries?q=${encodeURIComponent('問い合わせ4999')}`), t);
    assert.equal(search.body.total, 1);

    const summary = await timed('集計(A-01〜A-06、1年分)', () => get('/api/reports/summary?from=2026-01-01&to=2026-12-31'), t);
    assert.equal(summary.body.a06.reduce((sum, r) => sum + r.count, 0), COUNT);

    // 集計期間の上限(20年 = 240か月)でも、1秒以内に返る
    const widest = await timed('集計(上限の20年)', () => get('/api/reports/summary?from=2007-01-01&to=2026-12-31'), t);
    assert.equal(widest.body.a05.length, 240);
    assert.equal(widest.body.a06.reduce((sum, r) => sum + r.count, 0), COUNT);

    const csv = await timed('一覧CSV(全件)', () => get('/api/inquiries/export.csv'), t);
    assert.equal(csv.text.slice(1).trimEnd().split('\r\n').length, COUNT + 1);

    await timed('集計CSV', () => get('/api/reports/export.csv?type=a03&from=2026-01-01&to=2026-12-31'), t);

    const detail = await timed('詳細(履歴つき)', () => get('/api/inquiries/2500'), t);
    assert.ok(detail.body.histories.length >= 1);
  } finally {
    await app.close();
  }
});
