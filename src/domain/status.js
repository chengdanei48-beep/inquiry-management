// ステータス遷移(docs/requirements.md 4章、docs/api-design.md 5.4)。
// 定義(ステータス・優先度・遷移)はブラウザと共有するため、public/js/status.js にある。
import { AppError, validationError } from '../http/errors.js';
import { canTransition, COMPLETED, isLocked } from '../../public/js/status.js';

export {
  availableTransitions, canTransition, COMPLETED, isLocked, PRIORITIES, STATUSES,
} from '../../public/js/status.js';

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
