import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const MIN_PASSWORD_LENGTH = 12;

/**
 * 設定を環境変数から読み込む(docs/api-design.md 3章)。
 * - PORT: 既定 8080
 * - DB_PATH: 既定 data/inquiry.db(`:memory:` も指定できる)
 * - HOST: 待ち受けアドレス。既定 127.0.0.1(localhost のみ)。外部に公開するときだけ 0.0.0.0 などを指定する
 * - APP_PASSWORD: 認証(Basic 認証)のパスワード(12 文字以上)。**localhost 以外で待ち受けるときは必須**
 * - APP_USER: 認証のユーザー名。既定 admin
 * - ALLOWED_HOSTS: localhost 以外で受け付ける Host ヘッダーの名前(カンマ区切り。`*` で全て)
 *
 * 認証なしで、外部に公開してしまう事故を防ぐため、HOST が localhost 以外で
 * APP_PASSWORD が無いときは、設定の読み込みでエラーにする(起動しない)。
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

  const host = env.HOST === undefined || env.HOST === '' ? '127.0.0.1' : env.HOST;
  if (!LOOPBACK_HOSTS.has(host) && net.isIP(host) === 0) {
    throw new Error(`HOST の値が正しくありません(IP アドレスを指定してください): ${host}`);
  }
  const isLoopback = LOOPBACK_HOSTS.has(host);

  const password = env.APP_PASSWORD === undefined ? '' : env.APP_PASSWORD;
  if (password !== '' && password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`APP_PASSWORD は ${MIN_PASSWORD_LENGTH} 文字以上にしてください`);
  }
  if (!isLoopback && password === '') {
    throw new Error('HOST に localhost 以外を指定するときは、APP_PASSWORD(認証のパスワード)が必要です。認証なしで外部に公開しません');
  }
  const user = env.APP_USER === undefined || env.APP_USER === '' ? 'admin' : env.APP_USER;
  if (user.includes(':')) throw new Error('APP_USER に ":" は使えません');

  const allowedHosts = (env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  return {
    host,
    port,
    dbPath,
    publicDir: path.join(ROOT, 'public'),
    // 認証。パスワードが無いとき(localhost のみ)は、認証しない
    auth: password === '' ? null : { user, password },
    // localhost 以外の Host ヘッダーで、受け付ける名前(['*'] は全て)
    allowedHosts,
    // 月次集計の保存先。DBファイルと同じディレクトリの reports/(既定は data/reports/YYYY-MM/)
    reportsDir: path.join(dbPath === ':memory:' ? path.join(ROOT, 'data') : path.dirname(dbPath), 'reports'),
  };
}
