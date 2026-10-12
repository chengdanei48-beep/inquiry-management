// 画面の入力検証(サーバーと同じ規則・文言。docs/screen-design.md 2.3)。
// サーバー側でも必ず検証する。ここは、送信前に利用者へすぐ知らせるためのもの。

export const MAX_TEXT_LENGTH = 50;

/** 文字数(サロゲートペアを1文字と数える。サーバー・DBと同じ)。 */
export const textLength = (s) => [...s].length;

/**
 * 自由入力の文字列を検証する。
 * @returns {{ value: string, error: string }} 前後の空白を除いた値と、エラー文言(無ければ空)
 */
export function validateText(label, raw, { required = true } = {}) {
  const value = (raw ?? '').trim();
  if (value === '') return { value, error: required ? `${label}を入力してください` : '' };
  if (textLength(value) > MAX_TEXT_LENGTH) {
    return { value, error: `${label}は${MAX_TEXT_LENGTH}文字以内で入力してください` };
  }
  return { value, error: '' };
}

/** 選択肢が選ばれているか。 */
export function validateChoice(label, raw) {
  return raw === undefined || raw === null || raw === '' ? `${label}を選択してください` : '';
}

/** 関連する問い合わせID(任意)。空なら null。 */
export function parseOptionalId(label, raw) {
  const s = (raw ?? '').trim();
  if (s === '') return { value: null, error: '' };
  if (!/^\d+$/.test(s) || Number(s) < 1) return { value: null, error: `${label}を正しく入力してください` };
  return { value: Number(s), error: '' };
}
