// エラーの文言(docs/screen-design.md 2.3)。内部情報(SQL・URL・ステータスコード)は表示しない。
import { ApiError, NETWORK_ERROR_MESSAGE, SERVER_ERROR_MESSAGE } from './api.js';

export const OPERATOR_REQUIRED_MESSAGE = '操作する担当者を選択してください';
export const NO_DATA_MESSAGE = '該当するデータはありません';

/**
 * ApiError(またはその他の例外)を、利用者向けの文言にする。
 * @param {unknown} err
 * @param {{ notFound?: string }} [context] 404 のときの文言
 */
export function describeError(err, { notFound = '見つかりません' } = {}) {
  if (!(err instanceof ApiError)) return SERVER_ERROR_MESSAGE;
  if (err.isNetwork) return NETWORK_ERROR_MESSAGE;
  if (err.status >= 500) return SERVER_ERROR_MESSAGE;
  if (err.isNotFound) return notFound;
  // 400・409 は、サーバーが設計書の文言で返す
  return err.message || SERVER_ERROR_MESSAGE;
}

/** 項目ごとのエラーを { field: message } にする。 */
export function fieldErrors(err) {
  if (!(err instanceof ApiError)) return {};
  return Object.fromEntries(err.fields.map((f) => [f.field, f.message]));
}
