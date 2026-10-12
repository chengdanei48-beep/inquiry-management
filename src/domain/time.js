// 日時と対応時間の計算(docs/api-design.md 6.4、requirements.md 5.3)。
//
// 日時は 'YYYY-MM-DD HH:mm:ss.SSS'(日本時間のローカル時刻)の文字列で扱う。
// 計算は「壁時計の値をそのまま UTC として扱う」ことで、実行環境のタイムゾーン・
// 夏時間に依存しないようにする。

const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 営業時間: 平日(月〜金)の 9:00〜18:00。祝日・昼休みは考慮しない。 */
export const BUSINESS_OPEN = 9 * HOUR;
export const BUSINESS_CLOSE = 18 * HOUR;

const pad = (n, width = 2) => String(n).padStart(width, '0');

/** Date を 'YYYY-MM-DD HH:mm:ss.SSS'(実行環境のローカル時刻)の文字列にする。 */
export function formatDateTime(date = new Date()) {
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
  );
}

/** エポックミリ秒(壁時計の値を UTC とみなしたもの)を 'YYYY-MM-DD HH:mm:ss.SSS' にする。 */
export function formatEpoch(ms) {
  const d = new Date(ms);
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`
  );
}

/**
 * 更新日時として使う値を返す。now が previous より後ならそのまま、そうでなければ
 * previous の1ミリ秒後にする。更新日時を必ず増やし、同じ値で別の更新が
 * 競合を見逃さないようにする(楽観ロックの確実な検出のため)。
 */
export function laterOf(now, previous) {
  const n = parseDateTime(now);
  const p = parseDateTime(previous);
  return n > p ? now : formatEpoch(p + 1);
}

/** 'YYYY-MM-DD HH:mm:ss.SSS' の形で、実在する日時か。 */
export function isDateTimeString(value) {
  try {
    parseDateTime(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * 'YYYY-MM-DD HH:mm:ss.SSS' を、壁時計の値を UTC とみなしたエポックミリ秒にする。
 * 形式が違う、または存在しない日時(2月30日など)は RangeError。
 */
export function parseDateTime(value) {
  const m = typeof value === 'string' ? DATETIME_RE.exec(value) : null;
  if (!m) throw new RangeError(`日時の形式が正しくありません: ${value}`);
  const [y, mo, d, h, mi, s, ms] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  const check = new Date(t);
  if (
    check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d ||
    h > 23 || mi > 59 || s > 59
  ) {
    throw new RangeError(`存在しない日時です: ${value}`);
  }
  return t;
}

/**
 * 対応履歴から「保留」の期間を求める。
 * 履歴のうち type が 'status' のものを使い、to_status が「保留」になった日時から、
 * from_status が「保留」である次の変更の日時までを1つの期間とする。
 * 完了時点で保留が続いている場合は、until までを期間とする。
 *
 * @param {Array<{type: string, from_status?: string, to_status?: string, at: string}>} histories
 * @param {string} until 'YYYY-MM-DD HH:mm:ss.SSS'
 * @returns {Array<[number, number]>} [開始, 終了] のエポックミリ秒
 */
export function holdIntervals(histories, until) {
  const changes = histories
    .filter((h) => h.type === 'status')
    .map((h) => ({ from: h.from_status, to: h.to_status, at: parseDateTime(h.at) }))
    .sort((a, b) => a.at - b.at);

  const intervals = [];
  let start = null;
  for (const c of changes) {
    if (c.to === '保留' && start === null) {
      start = c.at;
    } else if (c.from === '保留' && start !== null) {
      intervals.push([start, c.at]);
      start = null;
    }
  }
  if (start !== null) intervals.push([start, parseDateTime(until)]);
  return intervals;
}

// 区間を、開始順に並べて重なりをまとめる
function mergeIntervals(intervals) {
  const sorted = intervals.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

const overlap = (aStart, aEnd, bStart, bEnd) => Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

/**
 * [start, end] のうち、営業時間(平日 9:00〜18:00)内で、pauses に含まれない時間を分で返す。
 * 分未満は切り捨てる。
 *
 * @param {number} start エポックミリ秒(壁時計の値を UTC とみなしたもの)
 * @param {number} end
 * @param {Array<[number, number]>} [pauses] 除く期間(保留)
 */
export function businessMinutes(start, end, pauses = []) {
  if (end < start) throw new RangeError('終了が開始より前です');
  const merged = mergeIntervals(pauses);
  let total = 0;
  for (let day = Math.floor(start / DAY) * DAY; day < end; day += DAY) {
    const weekday = new Date(day).getUTCDay(); // 0=日, 6=土
    if (weekday === 0 || weekday === 6) continue;
    const winStart = Math.max(start, day + BUSINESS_OPEN);
    const winEnd = Math.min(end, day + BUSINESS_CLOSE);
    if (winEnd <= winStart) continue;
    let ms = winEnd - winStart;
    for (const [ps, pe] of merged) ms -= overlap(winStart, winEnd, ps, pe);
    total += ms;
  }
  return Math.floor(total / MINUTE);
}

/**
 * 問い合わせの対応時間(分)。受付日時から完了日時までのうち、営業時間内で、
 * 保留の期間を除いた時間。
 */
export function workMinutes({ receivedAt, completedAt, histories = [] }) {
  const start = parseDateTime(receivedAt);
  const end = parseDateTime(completedAt);
  return businessMinutes(start, end, holdIntervals(histories, completedAt));
}

/** 分を 'H:mm' にする(null は '-')。 */
export function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return '-';
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}
