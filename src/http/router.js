import { validationError } from './errors.js';

const MAX_BODY_BYTES = 64 * 1024;

/**
 * 小さなルーター。`/api/inquiries/:id` のようなパスパラメータに対応する。
 * 一致するパスが無ければ null を返す(呼び出し側が 404 を返す)。
 */
export function createRouter(routes = []) {
  const compiled = routes.map(({ method, path, handler }) => {
    const names = [];
    const pattern = path
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          names.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    return { method, regex: new RegExp(`^${pattern}$`), names, handler };
  });

  return {
    match(method, pathname) {
      for (const route of compiled) {
        if (route.method !== method) continue;
        const m = route.regex.exec(pathname);
        if (!m) continue;
        const params = {};
        try {
          route.names.forEach((name, i) => {
            params[name] = decodeURIComponent(m[i + 1]);
          });
        } catch {
          // 不正なパーセントエンコード(例: %ZZ)は、存在しないパスとして扱う(404)
          return null;
        }
        return { handler: route.handler, params };
      }
      return null;
    },
  };
}

/** リクエストボディをJSONとして読む(上限 64KB)。空なら `{}` を返す。 */
export async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw validationError(undefined, 'リクエストが大きすぎます');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw validationError(undefined, 'リクエストの形式が正しくありません');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw validationError(undefined, 'リクエストの形式が正しくありません');
  }
  return parsed;
}
