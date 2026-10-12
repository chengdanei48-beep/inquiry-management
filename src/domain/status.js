// ステータス遷移(docs/requirements.md 4章、docs/api-design.md 5.4)。
//
//   未対応 → 対応中 ⇄ 保留
//             ↓
//            完了(最終状態。再開しない)
import { AppError, validationError } from '../http/errors.js';

export const STATUSES = ['未対応', '対応中', '保留', '完了'];
export const PRIORITIES = ['高', '中', '低'];
export const COMPLETED = '完了';

const TRANSITIONS = {
  未対応: ['対応中'],
  対応中: ['保留', '完了'],
  保留: ['対応中'],
  完了: [],
};

/** 現在のステータスから変更できるステータス(画面のボタンの出し分けに使う)。 */
export function availableTransitions(status) {
  return [...(TRANSITIONS[status] ?? [])];
}

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** 完了済みの問い合わせは、編集・担当者変更ができない(コメントのみ可)。 */
export function isLocked(status) {
  return status === COMPLETED;
}

export function assertNotLocked(status) {
  if (isLocked(status)) {
    throw new AppError(409, 'COMPLETED_LOCKED', '完了済みのため編集できません');
  }
}

/**
 * ステータス変更の可否を判定し、できなければ設計書のエラーを投げる。
 * 判定の順序: 遷移の可否(409) → 担当者(409) → 完了時の対応内容(400)。
 *
 * @param {object} args
 * @param {string} args.from 現在のステータス
 * @param {string} args.to 変更後のステータス
 * @param {number|null} args.assigneeId 現在の担当者(未割当は null)
 * @param {string|null} [args.resolution] 完了時の対応内容(検証済みの値)
 */
export function assertCanChangeStatus({ from, to, assigneeId, resolution }) {
  if (!canTransition(from, to)) {
    throw new AppError(409, 'INVALID_TRANSITION', '現在のステータスからは変更できません');
  }
  // 遷移できるのは「対応中」「保留」「完了」のみなので、担当者は常に必須
  if (assigneeId === null || assigneeId === undefined) {
    throw new AppError(409, 'ASSIGNEE_REQUIRED', '担当者を割り当ててください');
  }
  if (to === COMPLETED && !resolution) {
    throw validationError([{ field: 'resolution', message: '対応内容を入力してください' }]);
  }
}
