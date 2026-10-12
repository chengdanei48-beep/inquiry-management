// 表示形式(docs/screen-design.md 2.2)。日付は YYYY/MM/DD、時刻は HH:mm(24時間表記)。
export { formatMinutes } from './report-tables.js';

/** 'YYYY-MM-DD HH:mm:ss.SSS' を 'YYYY/MM/DD HH:mm' にする。値がなければ空文字。 */
export function formatDateTime(value) {
  if (typeof value !== 'string' || value.length < 16) return '';
  return value.slice(0, 16).replace(/-/g, '/');
}

/** 'YYYY-MM-DD' を 'YYYY/MM/DD' にする。 */
export function formatDate(value) {
  return typeof value === 'string' ? value.replace(/-/g, '/') : '';
}
