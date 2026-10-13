import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { AppError, notFound, sendError, sendJson } from './http/errors.js';
import { createRouter, readJson } from './http/router.js';
import { formatDateTime } from './domain/time.js';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

// 外部のCDN・スクリプトを許可しない(CLAUDE.md の課金ルール・ローカル完結)
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
};

// DNSリバインディング対策: 既定では、localhost 宛のリクエストだけを受け付ける。
// 外部に公開するとき(ALLOWED_HOSTS)だけ、指定された Host 名(または *)も受け付ける
const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function isHostAllowed(hostHeader, config) {
  const hostname = hostnameOf(hostHeader).toLowerCase();
  if (ALLOWED_HOSTNAMES.has(hostname)) return true;
  const extra = config.allowedHosts ?? [];
  return extra.includes('*') || (hostname !== '' && extra.includes(hostname));
}

// Basic 認証。パスワードの比較は、長さが漏れないよう、ハッシュにして、定数時間で行う
const sha256 = (text) => crypto.createHash('sha256').update(text).digest();

function isAuthorized(req, auth) {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !/^Basic /i.test(header)) return false;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  } catch {
    return false;
  }
  return crypto.timingSafeEqual(sha256(decoded), sha256(`${auth.user}:${auth.password}`));
}

function sendUnauthorized(res) {
  res.writeHead(401, {
    'Content-Type': 'text/plain; charset=utf-8',
    'WWW-Authenticate': 'Basic realm="inquiry-management", charset="UTF-8"',
    ...SECURITY_HEADERS,
  });
  res.end('認証が必要です');
}

function hostnameOf(hostHeader) {
  if (!hostHeader) return '';
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1);
  return hostHeader.split(':')[0];
}

function serveStatic(req, res, pathname, publicDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('Not Found');
    return;
  }
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    relative = null;
  }
  const target = relative === null || relative.includes('\0')
    ? null
    : path.resolve(publicDir, '.' + (relative === '/' ? '/index.html' : relative));
  // publicDir の外(../ など)は配信しない
  const inside = target !== null && (target === publicDir || target.startsWith(publicDir + path.sep));
  let stat = null;
  if (inside) {
    try { stat = fs.statSync(target); } catch { stat = null; }
  }
  if (!inside || !stat || !stat.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('Not Found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[path.extname(target)] || 'application/octet-stream',
    'Content-Length': stat.size,
    ...SECURITY_HEADERS,
  });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(target).pipe(res);
}

/**
 * HTTPサーバーを作る(まだ listen しない)。
 * @param {object} deps
 * @param {import('node:sqlite').DatabaseSync} deps.db
 * @param {{publicDir: string}} deps.config
 * @param {Array<{method: string, path: string, handler: Function}>} [deps.routes] APIのルート
 * @param {(line: string) => void} [deps.log] ログ出力(既定は標準出力)
 * @param {() => string} [deps.now] 現在日時('YYYY-MM-DD HH:mm:ss.SSS')。テストで差し替える
 */
export function createServer({
  db, config, routes = [], log = (line) => console.log(line), now = () => formatDateTime(new Date()),
}) {
  const router = createRouter(routes);

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url, 'http://localhost');
    res.on('finish', () => {
      // 入力内容はログに出さない(メソッド・パス・結果のみ)
      log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    });

    try {
      if (!isHostAllowed(req.headers.host, config)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'リクエストを受け付けられません');
      }

      // ヘルスチェック(認証なし。内容は固定で、データには触れない)
      if (url.pathname === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok' }));
        return;
      }

      // 認証(設定されているときだけ)。画面もAPIも、全てに適用する
      if (config.auth && !isAuthorized(req, config.auth)) {
        sendUnauthorized(res);
        return;
      }

      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        const matched = router.match(req.method, url.pathname);
        if (!matched) throw notFound();
        const ctx = { req, res, db, url, now, config, params: matched.params, readJson: () => readJson(req) };
        const result = await matched.handler(ctx);
        // ハンドラーが応答を終えていなければ、戻り値をJSONで返す
        if (!res.writableEnded) sendJson(res, result?.status ?? 200, result?.body ?? {});
        return;
      }

      serveStatic(req, res, url.pathname, config.publicDir);
    } catch (err) {
      if (res.headersSent) { res.end(); return; }
      if (err instanceof AppError) {
        sendError(res, err);
      } else {
        // 内部情報は返さず、サーバー側のログにだけ残す
        log(`ERROR ${req.method} ${url.pathname}: ${err?.message ?? err}`);
        sendError(res, new AppError(500, 'INTERNAL_ERROR', '処理に失敗しました。時間をおいて、もう一度お試しください'));
      }
    }
  });

  return server;
}
