// ハッシュ(#/...)から画面を決める(docs/screen-design.md 1章)。
//   #/inquiries            S-01 一覧(#/inquiries?status=...&page=2 のように条件を持てる)
//   #/inquiries/new        S-02 登録
//   #/inquiries/{id}       S-03 詳細
//   #/reports              S-04 集計
//   #/masters              S-05 マスタ管理

/**
 * @param {string} hash location.hash の値
 * @returns {{ name: 'list'|'new'|'detail'|'reports'|'masters'|'notfound', id?: number, search: string }}
 */
export function parseRoute(hash) {
  const raw = (hash || '').replace(/^#/, '') || '/inquiries';
  const qIndex = raw.indexOf('?');
  const path = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const search = qIndex === -1 ? '' : raw.slice(qIndex + 1);

  if (path === '/inquiries') return { name: 'list', search };
  if (path === '/inquiries/new') return { name: 'new', search };
  const detail = /^\/inquiries\/([1-9]\d*)$/.exec(path);
  if (detail) return { name: 'detail', id: Number(detail[1]), search };
  if (path === '/reports') return { name: 'reports', search };
  if (path === '/masters') return { name: 'masters', search };
  return { name: 'notfound', search };
}

/** メニューで強調する項目(詳細画面は「一覧」)。 */
export function menuOf(route) {
  if (route.name === 'detail') return 'list';
  return route.name;
}

export const MENU = [
  { name: 'list', href: '#/inquiries', label: '一覧' },
  { name: 'new', href: '#/inquiries/new', label: '新規登録' },
  { name: 'reports', href: '#/reports', label: '集計' },
  { name: 'masters', href: '#/masters', label: 'マスタ管理' },
];
