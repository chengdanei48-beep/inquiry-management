// S-01 問い合わせ一覧(docs/screen-design.md 3章)。
import { formField, selectInput, statusBadge, textInput } from '../components.js';
import { h } from '../dom.js';
import { formatDateTime } from '../format.js';
import { nextSort, parseListQuery, toApiQuery, toSearch } from '../list-query.js';
import { NO_DATA_MESSAGE } from '../messages.js';
import { STATUSES } from '../status.js';

const ALL = { value: '', label: 'すべて' };

function hashFor(query) {
  const search = toSearch(query);
  return `#/inquiries${search ? `?${search}` : ''}`;
}

export async function renderInquiryList(ctx, route) {
  const query = parseListQuery(route.search);
  const [categories, employees, result] = await Promise.all([
    ctx.api.listCategories(),
    ctx.api.listEmployees(),
    ctx.api.listInquiries(toApiQuery(query)),
  ]);
  const departments = [...new Set(employees.items.map((e) => e.department))].sort((a, b) => a.localeCompare(b, 'ja'));

  // ----- 絞り込み -----
  const status = selectInput([ALL, ...STATUSES.map((s) => ({ value: s, label: s }))], { value: query.status });
  const category = selectInput([ALL, ...categories.items.map((c) => ({ value: c.id, label: c.name }))], { value: query.categoryId });
  const assignee = selectInput([
    ALL, { value: 'none', label: '未割当' },
    ...employees.items.filter((e) => e.isStaff).map((e) => ({ value: e.id, label: e.name })),
  ], { value: query.assigneeId });
  const dept = selectInput([ALL, ...departments.map((d) => ({ value: d, label: d }))], { value: query.dept });
  const keyword = textInput(query.q);
  keyword.maxLength = 50;

  const fields = [
    formField('f-status', 'ステータス', status),
    formField('f-category', 'カテゴリ', category),
    formField('f-assignee', '担当者', assignee),
    formField('f-dept', '依頼者の部署', dept),
    formField('f-keyword', 'キーワード(件名・内容)', keyword),
  ];

  const form = h('form', { class: 'panel', role: 'search', 'aria-label': '絞り込み', novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      // 条件を変えて検索したら、1ページ目に戻る。並び順は保つ。
      ctx.navigate(hashFor({
        ...query,
        status: status.value, categoryId: category.value, assigneeId: assignee.value,
        dept: dept.value, q: keyword.value.trim(), page: 1,
      }));
    } },
  h('div', { class: 'row' }, fields.map((f) => f.el)),
  h('div', { class: 'actions' },
    h('button', { type: 'submit', class: 'primary' }, '検索'),
    h('button', { type: 'button', onclick: () => ctx.navigate(hashFor({ ...query, status: '', categoryId: '', assigneeId: '', dept: '', q: '', page: 1 })) }, '条件をクリア'),
    // 現在の絞り込み条件と並び順で、全件を出力する(ページに関係なく)
    h('a', { class: 'button', href: ctx.api.inquiriesCsvUrl(toApiQuery(query, { withPage: false })), download: '' }, 'CSV出力'),
    h('a', { class: 'button', href: '#/inquiries/new' }, '新規登録')));

  // ----- 一覧 -----
  const sortButton = (sort, label) => {
    const active = query.sort === sort;
    const arrow = active ? (query.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return h('button', { type: 'button', 'aria-label': `${label}で並び替え`,
      onclick: () => ctx.navigate(hashFor({ ...query, ...nextSort(query, sort), page: 1 })) }, `${label}${arrow}`);
  };

  const { items, total, page, pageSize } = result;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = (page - 1) * pageSize + items.length;

  let body;
  if (total === 0) {
    body = h('p', { class: 'msg info' }, NO_DATA_MESSAGE);
  } else if (items.length === 0) {
    body = h('div', { class: 'msg info' },
      h('span', {}, 'このページには表示するデータがありません。'),
      h('button', { type: 'button', onclick: () => ctx.navigate(hashFor({ ...query, page: 1 })) }, '1ページ目へ'));
  } else {
    body = h('table', {},
      h('caption', { class: 'sr-only' }, '問い合わせの一覧'),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col', class: 'num' }, 'ID'),
        h('th', { scope: 'col' }, '件名'),
        h('th', { scope: 'col' }, 'カテゴリ'),
        h('th', { scope: 'col' }, '依頼者(部署)'),
        h('th', { scope: 'col' }, sortButton('priority', '優先度')),
        h('th', { scope: 'col' }, 'ステータス'),
        h('th', { scope: 'col' }, '担当者'),
        h('th', { scope: 'col' }, sortButton('received', '受付日時')))),
      h('tbody', {}, items.map((i) => h('tr', {},
        h('td', { class: 'num' }, i.id),
        h('td', {}, h('a', { href: `#/inquiries/${i.id}` }, i.title)),
        h('td', {}, i.category.name),
        h('td', {}, `${i.requester.name}(${i.requester.dept})`),
        h('td', {}, i.priority),
        h('td', {}, statusBadge(i.status)),
        h('td', {}, i.assignee ? i.assignee.name : '未割当'),
        h('td', {}, formatDateTime(i.receivedAt))))));
  }

  const pager = total === 0 ? null : h('nav', { class: 'pager', 'aria-label': 'ページ' },
    h('button', { type: 'button', disabled: page <= 1, onclick: () => ctx.navigate(hashFor({ ...query, page: page - 1 })) }, '前へ'),
    h('span', {}, `全${total}件中 ${first}〜${last}件 / ${page}/${pages}ページ`),
    h('button', { type: 'button', disabled: page >= pages, onclick: () => ctx.navigate(hashFor({ ...query, page: page + 1 })) }, '次へ'));

  return h('div', {},
    h('h2', {}, '問い合わせ一覧'),
    form,
    h('div', { class: 'panel' }, body, pager));
}

