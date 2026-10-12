// 画面の土台: ルーティング、メニュー、操作する担当者、メッセージ領域。docs/screen-design.md 1〜2章。
import { createApi } from './api.js';
import { h, replace } from './dom.js';
import { describeError, OPERATOR_REQUIRED_MESSAGE } from './messages.js';
import { createOperatorStore } from './operator.js';
import { MENU, menuOf, parseRoute } from './route.js';
import { renderInquiryDetail } from './views/inquiry-detail.js';
import { renderInquiryList } from './views/inquiry-list.js';
import { renderInquiryNew } from './views/inquiry-new.js';
import { renderPlaceholder } from './views/placeholder.js';

const $ = (id) => document.getElementById(id);

const store = createOperatorStore();
let operatorId = store.get();
let operators = [];
let renderToken = 0;
let flashMessage = null;
let lastListHash = '#/inquiries';
const operatorBound = new Set(); // 操作する担当者が未選択の間、無効にするボタン

const api = createApi({ getOperatorId: () => operatorId });

// ---------- メッセージ領域 ----------

/** kind: 'error' | 'ok' | 'info'。action があれば、メッセージの横にボタンを置く。 */
function message(text, kind = 'info', action) {
  const box = $('messages');
  const el = h('div', { class: `msg ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', {}, text),
    action ? h('button', { type: 'button', onclick: action.onClick }, action.label) : null);
  replace(box, el);
}

function clearMessage() {
  replace($('messages'));
}

/** 次の画面の表示後に出すメッセージ(登録後に詳細へ移動するときなど)。 */
function flash(text, kind = 'ok') {
  flashMessage = { text, kind };
}

// ---------- 操作する担当者 ----------

function renderOperatorSelect() {
  const select = $('operator');
  if (!operators.some((o) => o.id === operatorId)) {
    operatorId = null;
    store.set(null);
  }
  replace(select,
    h('option', { value: '' }, '選択してください'),
    operators.map((o) => h('option', { value: String(o.id) }, o.name)));
  select.value = operatorId === null ? '' : String(operatorId);
}

function updateOperatorButtons() {
  for (const el of operatorBound) el.disabled = operatorId === null;
}

function requireOperator() {
  if (operatorId !== null) return true;
  message(OPERATOR_REQUIRED_MESSAGE, 'error');
  return false;
}

async function loadOperators() {
  const res = await api.listEmployees({ staff: '1', active: '1' });
  operators = res.items;
  renderOperatorSelect();
  updateOperatorButtons();
}

// ---------- ルーティング ----------

const needsOperator = (route) => route.name !== 'list' && route.name !== 'notfound';

const VIEWS = {
  list: renderInquiryList,
  new: renderInquiryNew,
  detail: renderInquiryDetail,
  reports: (c, r) => renderPlaceholder(c, r, '集計'),
  masters: (c, r) => renderPlaceholder(c, r, 'マスタ管理'),
  notfound: (c, r) => renderPlaceholder(c, r, '画面'),
};

function renderMenu(route) {
  const current = menuOf(route);
  replace($('menu'), MENU.map((m) => h('a', { href: m.href, 'aria-current': m.name === current ? 'page' : null }, m.label)));
}

function errorPanel(err, route) {
  return h('div', { class: 'panel' },
    h('div', { class: 'msg error', role: 'alert' },
      h('span', {}, describeError(err, { notFound: '問い合わせが見つかりません' })),
      h('button', { type: 'button', onclick: () => render() }, '再読み込み')),
    route.name === 'detail' ? h('a', { href: lastListHash }, '一覧へ戻る') : null);
}

async function render() {
  const token = ++renderToken;
  const route = parseRoute(location.hash);
  if (route.name === 'list') lastListHash = location.hash || '#/inquiries';

  renderMenu(route);
  operatorBound.clear();
  clearMessage();
  if (flashMessage) {
    message(flashMessage.text, flashMessage.kind);
    flashMessage = null;
  } else if (operatorId === null && needsOperator(route)) {
    message(OPERATOR_REQUIRED_MESSAGE, 'info');
  }

  const view = $('view');
  view.setAttribute('aria-busy', 'true');
  replace(view, h('p', { class: 'loading', role: 'status' }, '読み込み中…'));
  try {
    const content = await VIEWS[route.name](ctx, route);
    if (token !== renderToken) return; // 画面移動が先に行われた
    replace(view, content);
    updateOperatorButtons();
    const heading = view.querySelector('h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  } catch (err) {
    if (token !== renderToken) return;
    replace(view, errorPanel(err, route));
  } finally {
    if (token === renderToken) view.removeAttribute('aria-busy');
  }
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

// ---------- 画面に渡す機能 ----------

const ctx = {
  api,
  get operatorId() { return operatorId; },
  get operators() { return operators; },
  get listHash() { return lastListHash; },
  dialog: $('dialog'),
  message,
  clearMessage,
  flash,
  navigate,
  refresh: render,
  requireOperator,
  loadOperators,
  /** 操作する担当者が未選択の間、無効にするボタンとして登録する。 */
  bindOperator(el) {
    operatorBound.add(el);
    el.disabled = operatorId === null;
    return el;
  },
};

$('operator').addEventListener('change', (e) => {
  operatorId = e.target.value === '' ? null : Number(e.target.value);
  store.set(operatorId);
  updateOperatorButtons();
  const route = parseRoute(location.hash);
  if (operatorId === null && needsOperator(route)) message(OPERATOR_REQUIRED_MESSAGE, 'info');
  else clearMessage();
});

window.addEventListener('hashchange', render);

(async function start() {
  try {
    await loadOperators();
  } catch (err) {
    // 担当者の一覧を読めなくても、画面は表示する(一覧の閲覧は可能)
    message(describeError(err), 'error', { label: '再読み込み', onClick: () => location.reload() });
  }
  await render();
})();
