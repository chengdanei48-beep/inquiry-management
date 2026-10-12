import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 設定を環境変数から読み込む(docs/api-design.md 3章)。
 * - PORT: 既定 8080
 * - DB_PATH: 既定 data/inquiry.db(`:memory:` も指定できる)
 * 認証を持たないため、待ち受けは localhost(127.0.0.1)のみに固定する。
 */
export function loadConfig(env = process.env) {
  const port = env.PORT === undefined || env.PORT === '' ? 8080 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT の値が正しくありません: ${env.PORT}`);
  }
  let dbPath;
  if (!env.DB_PATH) dbPath = path.join(ROOT, 'data', 'inquiry.db');
  else if (env.DB_PATH === ':memory:') dbPath = ':memory:';
  else dbPath = path.resolve(env.DB_PATH);

  return {
    host: '127.0.0.1',
    port,
    dbPath,
    publicDir: path.join(ROOT, 'public'),
    // 月次集計の保存先。DBファイルと同じディレクトリの reports/(既定は data/reports/YYYY-MM/)
    reportsDir: path.join(dbPath === ':memory:' ? path.join(ROOT, 'data') : path.dirname(dbPath), 'reports'),
  };
}
