import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from './schema.js';

const BUSY_TIMEOUT_MS = 3000;

/** DBを開き、外部キー・待ち時間を設定して、スキーマを作成(初回のみ)する。 */
export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    migrate(db);
  } catch (err) {
    // 失敗したときにファイルを開いたままにしない
    db.close();
    throw err;
  }
  return db;
}
