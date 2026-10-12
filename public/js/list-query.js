// 一覧の検索条件。URL(ハッシュ)に持たせて、再読み込み・戻る・進むで条件を保つ。
import { STATUSES } from './status.js';

export const DEFAULT_LIST_QUERY = Object.freeze({
  status: '', categoryId: '', assigneeId: '', dept: '', q: '', sort: 'received', dir: 'desc', page: 1,
});

const SORTS = ['received', 'priority'];
const DIRS = ['asc', 'desc'];

/** 'a=1&b=2' 形式の文字列から、検証した検索条件を作る(不正な値は既定値にする)。 */
export function parseListQuery(search = '') {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const get = (k) => params.get(k) ?? '';
  const q = { ...DEFAULT_LIST_QUERY };
  if (STATUSES.includes(get('status'))) q.status = get('status');
  if (/^[1-9]\d*$/.test(get('categoryId'))) q.categoryId = get('categoryId');
  const assignee = get('assigneeId');
  if (assignee === 'none' || /^[1-9]\d*$/.test(assignee)) q.assigneeId = assignee;
  q.dept = get('dept').slice(0, 50);
  q.q = get('q').slice(0, 50);
  if (SORTS.includes(get('sort'))) q.sort = get('sort');
  if (DIRS.includes(get('dir'))) q.dir = get('dir');
  if (/^[1-9]\d*$/.test(get('page'))) q.page = Number(get('page'));
  return q;
}

/** 既定値と異なる項目だけを、URLのクエリ文字列にする(先頭の `?` なし)。 */
export function toSearch(query) {
  const parts = [];
  for (const key of Object.keys(DEFAULT_LIST_QUERY)) {
    const value = query[key];
    if (value === undefined || value === null || value === '' || value === DEFAULT_LIST_QUERY[key]) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
}

/** APIに渡す形(sort・dir・page は常に付ける)。 */
export function toApiQuery(query, { withPage = true } = {}) {
  const api = {
    status: query.status,
    categoryId: query.categoryId,
    assigneeId: query.assigneeId,
    dept: query.dept,
    q: query.q,
    sort: query.sort,
    dir: query.dir,
  };
  if (withPage) api.page = query.page;
  return api;
}

/** 優先度の並び替えボタンの次の方向。優先度は「高 → 低」(昇順)から、受付日時は新しい順から始める。 */
export function nextSort(query, sort) {
  if (query.sort === sort) return { sort, dir: query.dir === 'asc' ? 'desc' : 'asc' };
  return { sort, dir: sort === 'priority' ? 'asc' : 'desc' };
}

