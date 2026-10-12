// ステータス・優先度・遷移の定義(ブラウザとサーバーで共有する)。docs/requirements.md 4章。
//
//   未対応 → 対応中 ⇄ 保留
//             ↓
//            完了(最終状態。再開しない)

export const STATUSES = ['未対応', '対応中', '保留', '完了'];
export const PRIORITIES = ['高', '中', '低'];
export const COMPLETED = '完了';

export const TRANSITIONS = {
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

/** ステータス変更ボタンの文言(画面設計書 5章)。 */
export function transitionLabel(from, to) {
  if (to === '対応中') return from === '保留' ? '対応中に戻す' : '対応中にする';
  if (to === '保留') return '保留にする';
  return '完了にする';
}
