// S-05 マスタ管理(docs/screen-design.md 7章)。社員・カテゴリは削除できず、無効にして扱う。
import { focusFirstInvalid, formField, selectInput, textInput } from '../components.js';
import { h, replace } from '../dom.js';
import { describeError, fieldErrors } from '../messages.js';
import { validateText } from '../validation.js';

const STAFF_OPTIONS = [{ value: '0', label: '一般' }, { value: '1', label: '担当者' }];

function tabHash(tab) {
  return `#/masters?tab=${tab}`;
}

export async function renderMasters(ctx, route) {
  const tab = new URLSearchParams(route.search).get('tab') === 'categories' ? 'categories' : 'employees';
  const root = h('div', {});
  let items = (await (tab === 'employees' ? ctx.api.listEmployees() : ctx.api.listCategories())).items;
  let editingId = null;

  // 担当者が1人もいない初期状態では、最初の担当者を、操作者なしで追加できる(サーバーも同じ規則)
  const isBootstrap = () => tab === 'employees' && ctx.operators.length === 0;

  /** 一覧を取り直して、画面と「操作する担当者」の選択肢を更新する。 */
  async function reload() {
    const res = await (tab === 'employees' ? ctx.api.listEmployees() : ctx.api.listCategories());
    items = res.items;
    editingId = null;
    if (tab === 'employees') await ctx.loadOperators();
    draw();
  }

  /** 変更系の操作。失敗したら、サーバーの文言(409 の理由など)を表示する。 */
  async function mutate(action, successText, { anonymous = false } = {}) {
    if (!anonymous && !ctx.requireOperator()) return null;
    try {
      const result = await action();
      await reload();
      ctx.message(successText(result), 'ok');
      return result;
    } catch (err) {
      ctx.message(describeError(err), 'error');
      return null;
    }
  }

  // ----- 追加フォーム -----
  function addForm() {
    if (tab === 'employees') {
      const name = formField('a-name', '氏名', textInput(), { required: true, counter: true });
      const dept = formField('a-dept', '部署', textInput(), { required: true, counter: true });
      const bootstrap = isBootstrap();
      const staff = formField('a-staff', '担当者区分', selectInput(STAFF_OPTIONS, { value: bootstrap ? '1' : '0' }));
      const submit = h('button', { type: 'submit', class: 'primary' }, '追加');
      if (!bootstrap) ctx.bindOperator(submit);
      return h('form', { novalidate: true, 'aria-label': '社員を追加',
        onsubmit: async (e) => {
          e.preventDefault();
          const n = validateText('氏名', name.control.value);
          const d = validateText('部署', dept.control.value);
          name.setError(n.error);
          dept.setError(d.error);
          if (n.error || d.error) { focusFirstInvalid(e.target); return; }
          const created = await mutate(
            () => ctx.api.createEmployee({ name: n.value, department: d.value, isStaff: staff.control.value === '1' }),
            (c) => `${c.name}を追加しました`,
            { anonymous: bootstrap },
          );
          // 最初の担当者を追加したら、そのまま「操作する担当者」にする
          if (created && bootstrap && created.isStaff && ctx.operatorId === null) {
            ctx.setOperator(created.id);
            ctx.message(`${created.name}を追加し、操作する担当者に設定しました`, 'ok');
          }
        } },
      h('div', { class: 'row' }, name.el, dept.el, staff.el, h('div', { class: 'actions' }, submit)));
    }

    const nextOrder = items.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;
    const name = formField('a-name', '名称', textInput(), { required: true, counter: true });
    const order = formField('a-order', '表示順', h('input', { type: 'number', min: '0', step: '1', value: String(nextOrder) }), { required: true });
    const submit = ctx.bindOperator(h('button', { type: 'submit', class: 'primary' }, '追加'));
    return h('form', { novalidate: true, 'aria-label': 'カテゴリを追加',
      onsubmit: async (e) => {
        e.preventDefault();
        const n = validateText('名称', name.control.value);
        const o = /^\d+$/.test(order.control.value.trim()) ? '' : '表示順は0以上の整数で入力してください';
        name.setError(n.error);
        order.setError(o);
        if (n.error || o) { focusFirstInvalid(e.target); return; }
        if (!ctx.requireOperator()) return;
        try {
          const created = await ctx.api.createCategory({ name: n.value, sortOrder: Number(order.control.value) });
          await reload();
          ctx.message(`${created.name}を追加しました`, 'ok');
        } catch (err) {
          const errors = fieldErrors(err);
          if (err.code === 'DUPLICATE_NAME') { name.setError(err.message); name.control.focus(); }
          else if (errors.name || errors.sortOrder) { name.setError(errors.name || ''); order.setError(errors.sortOrder || ''); focusFirstInvalid(e.target); }
          else ctx.message(describeError(err), 'error');
        }
      } },
    h('div', { class: 'row' }, name.el, order.el, h('div', { class: 'actions' }, submit)));
  }

  // ----- 一覧(行内で編集する) -----
  function stateBadge(active) {
    return h('span', { class: 'badge', style: active ? '' : 'background:#e5e7eb' }, active ? '有効' : '無効');
  }

  function employeeRow(e) {
    if (editingId === e.id) {
      const name = textInput(e.name);
      name.setAttribute('aria-label', '氏名');
      const dept = textInput(e.department);
      dept.setAttribute('aria-label', '部署');
      const staff = selectInput(STAFF_OPTIONS, { value: e.isStaff ? '1' : '0' });
      staff.setAttribute('aria-label', '担当者区分');
      const save = ctx.bindOperator(h('button', { type: 'button', class: 'primary',
        onclick: async () => {
          const n = validateText('氏名', name.value);
          const d = validateText('部署', dept.value);
          const error = n.error || d.error;
          if (error) { ctx.message(error, 'error'); return; }
          await mutate(
            () => ctx.api.updateEmployee(e.id, { name: n.value, department: d.value, isStaff: staff.value === '1' }),
            () => '保存しました',
          );
        } }, '保存'));
      return h('tr', {}, h('td', {}, name), h('td', {}, dept), h('td', {}, staff), h('td', {}, stateBadge(e.isActive)),
        h('td', {}, save, ' ', h('button', { type: 'button', onclick: () => { editingId = null; draw(); } }, 'キャンセル')));
    }
    return h('tr', {},
      h('td', {}, e.name), h('td', {}, e.department), h('td', {}, e.isStaff ? '担当者' : '一般'), h('td', {}, stateBadge(e.isActive)),
      h('td', {},
        ctx.bindOperator(h('button', { type: 'button', onclick: () => { editingId = e.id; draw(); } }, '編集')), ' ',
        ctx.bindOperator(h('button', { type: 'button',
          onclick: () => mutate(
            () => ctx.api.updateEmployee(e.id, { isActive: !e.isActive }),
            () => (e.isActive ? `${e.name}を無効にしました` : `${e.name}を有効にしました`),
          ) }, e.isActive ? '無効にする' : '有効にする'))));
  }

  function categoryRow(c) {
    if (editingId === c.id) {
      const name = textInput(c.name);
      name.setAttribute('aria-label', '名称');
      const order = h('input', { type: 'number', min: '0', step: '1', value: String(c.sortOrder), 'aria-label': '表示順' });
      const save = ctx.bindOperator(h('button', { type: 'button', class: 'primary',
        onclick: async () => {
          const n = validateText('名称', name.value);
          if (n.error) { ctx.message(n.error, 'error'); return; }
          if (!/^\d+$/.test(order.value.trim())) { ctx.message('表示順は0以上の整数で入力してください', 'error'); return; }
          await mutate(
            () => ctx.api.updateCategory(c.id, { name: n.value, sortOrder: Number(order.value) }),
            () => '保存しました',
          );
        } }, '保存'));
      return h('tr', {}, h('td', {}, name), h('td', {}, order), h('td', {}, stateBadge(c.isActive)),
        h('td', {}, save, ' ', h('button', { type: 'button', onclick: () => { editingId = null; draw(); } }, 'キャンセル')));
    }
    return h('tr', {},
      h('td', {}, c.name), h('td', { class: 'num' }, c.sortOrder), h('td', {}, stateBadge(c.isActive)),
      h('td', {},
        ctx.bindOperator(h('button', { type: 'button', onclick: () => { editingId = c.id; draw(); } }, '編集')), ' ',
        ctx.bindOperator(h('button', { type: 'button',
          onclick: () => mutate(
            () => ctx.api.updateCategory(c.id, { isActive: !c.isActive }),
            () => (c.isActive ? `${c.name}を無効にしました` : `${c.name}を有効にしました`),
          ) }, c.isActive ? '無効にする' : '有効にする'))));
  }

  function draw() {
    const heads = tab === 'employees' ? ['氏名', '部署', '担当者区分', '状態', '操作'] : ['名称', '表示順', '状態', '操作'];
    const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'マスタの種類' },
      [['employees', '社員'], ['categories', 'カテゴリ']].map(([key, label]) =>
        h('button', { type: 'button', role: 'tab', 'aria-selected': tab === key ? 'true' : 'false',
          onclick: () => ctx.navigate(tabHash(key)) }, label)));
    replace(root,
      h('h2', {}, 'マスタ管理'),
      tabs,
      h('section', { class: 'panel', 'aria-labelledby': 'add-title' },
        h('h3', { id: 'add-title' }, tab === 'employees' ? '社員を追加' : 'カテゴリを追加'),
        addForm()),
      h('section', { class: 'panel', 'aria-labelledby': 'list-title' },
        h('h3', { id: 'list-title' }, tab === 'employees' ? '社員の一覧' : 'カテゴリの一覧'),
        items.length === 0
          ? h('p', { class: 'muted' }, '登録されていません')
          : h('table', {},
            h('caption', { class: 'sr-only' }, tab === 'employees' ? '社員の一覧' : 'カテゴリの一覧'),
            h('thead', {}, h('tr', {}, heads.map((t) => h('th', { scope: 'col' }, t)))),
            h('tbody', {}, items.map((i) => (tab === 'employees' ? employeeRow(i) : categoryRow(i))))),
        h('p', { class: 'muted' }, '削除はできません。無効にした項目は、新規の選択肢には表示されません。')));
  }

  draw();
  return root;
}
