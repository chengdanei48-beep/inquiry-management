// 画面の共通部品(フォーム項目・ステータス表示など)。docs/screen-design.md 2章。
import { h } from './dom.js';
import { textLength } from './validation.js';

/**
 * ラベル・必須表示・文字数カウンタ・エラー表示を持つフォーム項目。
 * エラー表示は role="alert"、エラー時は入力欄に aria-invalid を付ける。
 */
export function formField(id, label, control, { required = false, counter = false } = {}) {
  const errorEl = h('div', { class: 'field-error', id: `${id}-error`, role: 'alert' });
  const countEl = counter ? h('div', { class: 'counter', id: `${id}-count` }, '0/50') : null;
  control.id = id;
  control.setAttribute('aria-describedby', [counter ? `${id}-count` : null, `${id}-error`].filter(Boolean).join(' '));
  if (required) control.setAttribute('aria-required', 'true');
  if (counter) {
    const update = () => { countEl.textContent = `${textLength(control.value)}/50`; };
    control.addEventListener('input', update);
    update();
  }
  const el = h('div', { class: 'field' },
    h('label', { for: id }, label, required ? h('span', { class: 'req' }, '必須') : null),
    control, countEl, errorEl);
  return {
    el,
    control,
    setError(message) {
      errorEl.textContent = message || '';
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    },
  };
}

export function textInput(value = '') {
  return h('input', { type: 'text', value, autocomplete: 'off' });
}

export function textArea(value = '', rows = 3) {
  const el = h('textarea', { rows });
  el.value = value;
  return el;
}

/** options: [{ value, label }]。placeholder があれば先頭に空の選択肢を置く。 */
export function selectInput(options, { value = '', placeholder } = {}) {
  return h('select', { value },
    placeholder ? h('option', { value: '' }, placeholder) : null,
    options.map((o) => h('option', { value: String(o.value) }, o.label)));
}

/** ステータスは文言で表示し、色だけで区別しない。 */
export function statusBadge(status) {
  return h('span', { class: `badge st-${status}` }, status);
}

/** 最初の入力エラーのある項目にフォーカスを移す。 */
export function focusFirstInvalid(root) {
  const bad = root.querySelector('[aria-invalid="true"]');
  if (bad) bad.focus();
}
