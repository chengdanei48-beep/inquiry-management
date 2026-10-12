// 日付・期間・月の処理(集計画面)。日付は 'YYYY-MM-DD'、月は 'YYYY-MM'(実行環境のローカル時刻)。

const pad = (n) => String(n).padStart(2, '0');
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 'YYYY-MM-DD' が実在する日付か。 */
export function isDateText(value) {
  const m = typeof value === 'string' ? DATE_RE.exec(value) : null;
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export const isMonthText = (value) => typeof value === 'string' && MONTH_RE.test(value);

export function toDateText(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 当月の1日(例: 2026-10-01)。 */
export function firstOfMonth(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
}

/** 先月('YYYY-MM')。 */
export function previousMonth(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** 集計期間の既定(当月1日〜今日)。 */
export function defaultRange(now = new Date()) {
  return { from: firstOfMonth(now), to: toDateText(now) };
}

/**
 * URLのクエリから集計期間を作る。不正・未指定の値は、既定値にする。
 * @param {string} search 'from=2026-07-01&to=2026-10-12'
 */
export function parseReportRange(search = '', now = new Date()) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const base = defaultRange(now);
  const from = params.get('from');
  const to = params.get('to');
  return {
    from: isDateText(from) ? from : base.from,
    to: isDateText(to) ? to : base.to,
  };
}

/**
 * 期間の入力を検証する(サーバーと同じ文言)。
 * @returns {{ from?: string, to?: string }} 項目ごとのエラー(無ければ空のオブジェクト)
 */
export function validateRange(from, to) {
  const errors = {};
  if (!from) errors.from = '開始日を入力してください';
  else if (!isDateText(from)) errors.from = '開始日を正しく入力してください';
  if (!to) errors.to = '終了日を入力してください';
  else if (!isDateText(to)) errors.to = '終了日を正しく入力してください';
  if (!errors.from && !errors.to && from > to) errors.from = '開始日は終了日以前の日付にしてください';
  if (!errors.from && !errors.to && exceedsMaxRange(from, to)) errors.to = RANGE_TOO_WIDE_MESSAGE;
  return errors;
}

/** 集計期間の上限(年)。極端に広い期間で、集計や画面が重くならないようにする。 */
export const MAX_RANGE_YEARS = 10;
// 文言は、画面設計書 2.3 と一致させる(test/consistency.test.js が、設計書の文言がコードにあることを確認する)
export const RANGE_TOO_WIDE_MESSAGE = '集計期間は10年以内にしてください';

/** 開始日から MAX_RANGE_YEARS 年を超える期間か(どちらも実在する日付であること)。 */
export function exceedsMaxRange(from, to) {
  const [y, m, d] = from.split('-').map(Number);
  const limit = new Date(Date.UTC(y + MAX_RANGE_YEARS, m - 1, d));
  const text = `${limit.getUTCFullYear()}-${pad(limit.getUTCMonth() + 1)}-${pad(limit.getUTCDate())}`;
  return to > text;
}

/** 'YYYY-MM' を 'YYYY/MM' にする。 */
export function formatMonth(month) {
  return typeof month === 'string' ? month.replace('-', '/') : '';
}
