import { operatorRequired } from '../http/errors.js';
import { findEmployee } from '../repo/inquiries.js';

/**
 * 変更系APIの操作者(ヘッダー X-Operator-Id)を確認する。
 * 有効な「担当者」区分の社員でなければ 400 OPERATOR_REQUIRED。
 * @returns {{ id: number, name: string }}
 */
export function requireOperator(db, req) {
  const raw = req.headers['x-operator-id'];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw operatorRequired();
  const id = Number(raw);
  const employee = Number.isSafeInteger(id) && id >= 1 ? findEmployee(db, id) : undefined;
  if (!employee || !employee.is_staff || !employee.is_active) throw operatorRequired();
  return { id: employee.id, name: employee.name };
}
