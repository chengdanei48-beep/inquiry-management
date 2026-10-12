// APIテスト用の補助(テストファイルとしては実行されない)。
// インメモリDB・固定の時計・テスト用ポートで、アプリ全体を起動する。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db/index.js';
import { createServer } from '../src/server.js';
import { createApiRoutes } from '../src/api/index.js';
import { formatEpoch, parseDateTime } from '../src/domain/time.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** 社員ID: 1〜3=担当者(有効)、4〜5=一般(有効)、6=担当者(無効)、7=一般(無効)。カテゴリID: 1〜3=有効、4=無効。 */
function seedMasters(db) {
  const emp = db.prepare('INSERT INTO employees (name, department, is_staff, is_active) VALUES (?, ?, ?, ?)');
  emp.run('山田 太郎', '情報システム', 1, 1);
  emp.run('佐藤 花子', '情報システム', 1, 1);
  emp.run('鈴木 一郎', '総務', 1, 1);
  emp.run('高橋 美咲', '人事', 0, 1);
  emp.run('田中 健太', '営業', 0, 1);
  emp.run('退職 者', '総務', 1, 0);
  emp.run('異動 者', '営業', 0, 0);
  const cat = db.prepare('INSERT INTO categories (name, sort_order, is_active) VALUES (?, ?, ?)');
  cat.run('PC・ネットワーク', 1, 1);
  cat.run('アカウント・権限', 2, 1);
  cat.run('備品・ソフト申請', 3, 1);
  cat.run('廃止カテゴリ', 4, 0);
}

export async function startTestApp({ now = '2026-10-12 09:00:00.000' } = {}) {
  const db = openDatabase(':memory:');
  seedMasters(db);

  // 固定の時計。set / advance で進める
  let current = parseDateTime(now);
  const clock = {
    now: () => formatEpoch(current),
    set(value) { current = parseDateTime(value); },
    advanceMinutes(n) { current += n * 60 * 1000; },
  };

  // 月次集計の保存先(テストごとの一時ディレクトリ。終了時に削除する)
  const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inq-reports-'));

  const logs = [];
  const server = createServer({
    db, config: { publicDir, reportsDir }, routes: createApiRoutes(), log: (l) => logs.push(l), now: clock.now,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  /** operator に null を渡すと X-Operator-Id を付けない。 */
  async function api(method, urlPath, { body, operator = 1, headers = {} } = {}) {
    const h = { ...headers };
    if (operator !== null) h['X-Operator-Id'] = String(operator);
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${urlPath}`, {
      method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
    });
    // fetch の text() は先頭の BOM を取り除くため、バイト列から復号する(CSVの BOM を検証できるように)
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.toString('utf8');
    let json = null;
    try { json = JSON.parse(text); } catch { /* JSONでない応答 */ }
    return { status: res.status, body: json, text, bytes, headers: res.headers };
  }

  const validInquiry = {
    title: 'VPNに接続できない', body: '在宅勤務で接続不可', requesterId: 5, categoryId: 1, priority: '高',
  };

  return {
    db, clock, api, logs, validInquiry, reportsDir,
    /** 問い合わせを登録して、詳細を返す。 */
    async create(overrides = {}, opts = {}) {
      const res = await api('POST', '/api/inquiries', { body: { ...validInquiry, ...overrides }, ...opts });
      if (res.status !== 201) throw new Error(`登録に失敗: ${res.status} ${res.text}`);
      return res.body;
    },
    close: () => new Promise((resolve) => server.close(() => {
      db.close();
      fs.rmSync(reportsDir, { recursive: true, force: true });
      resolve();
    })),
  };
}

/** アプリを起動して fn を実行し、必ず後始末する。 */
export async function withApp(fn, options) {
  const app = await startTestApp(options);
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}
