// エラー応答(docs/api-design.md 3章)。
// 形式: { "error": { "code", "message", "fields"? } }

export class AppError extends Error {
  /**
   * @param {number} status HTTPステータス
   * @param {string} code エラーコード(例: VALIDATION_ERROR)
   * @param {string} message 利用者向けの文言(内部情報を含めない)
   * @param {Array<{field: string, message: string}>} [fields] 項目ごとのエラー
   */
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const validationError = (fields, message = '入力内容を確認してください') =>
  new AppError(400, 'VALIDATION_ERROR', message, fields);
export const operatorRequired = () =>
  new AppError(400, 'OPERATOR_REQUIRED', '操作する担当者を選択してください');
export const notFound = (message = '見つかりません') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code, message) => new AppError(409, code, message);

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export function sendError(res, err) {
  const body = { error: { code: err.code, message: err.message } };
  if (err.fields) body.error.fields = err.fields;
  sendJson(res, err.status, body);
}
