// S-04 集計(docs/screen-design.md 6章)。
import { renderReportChart } from '../charts.js';
import { formField, textInput } from '../components.js';
import { formatMonth, parseReportRange, previousMonth, validateRange } from '../dates.js';
import { h, replace, svgFromString } from '../dom.js';
import { formatDateTime } from '../format.js';
import { describeError, fieldErrors, NO_DATA_MESSAGE } from '../messages.js';
import { REPORT_TYPES, REPORTS } from '../report-tables.js';

function rangeHash(from, to) {
  return `#/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

const dateInput = (value) => h('input', { type: 'date', value });

export async function renderReports(ctx, route) {
  const range = parseReportRange(route.search);
  const [summary, monthly] = await Promise.all([
    ctx.api.getSummary(range.from, range.to),
    ctx.api.listMonthly(),
  ]);
  let saved = monthly.items;

  // ----- 期間 -----
  const from = formField('r-from', '開始日', dateInput(range.from), { required: true });
  const to = formField('r-to', '終了日', dateInput(range.to), { required: true });
  const periodForm = h('form', { novalidate: true, 'aria-label': '集計期間',
    onsubmit: (e) => {
      e.preventDefault();
      const errors = validateRange(from.control.value, to.control.value);
      from.setError(errors.from || '');
      to.setError(errors.to || '');
      if (errors.from || errors.to) {
        (errors.from ? from : to).control.focus();
        return;
      }
      ctx.navigate(rangeHash(from.control.value, to.control.value));
    } },
  h('div', { class: 'row' }, from.el, to.el,
    h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary' }, '表示'))));

  // ----- 月次保存 -----
  const month = formField('r-month', '対象月', h('input', { type: 'month', value: previousMonth() }), { required: true });
  const savedList = h('div', {});

  function drawSaved() {
    if (saved.length === 0) {
      replace(savedList, h('p', { class: 'muted' }, '保存済みの月はありません'));
      return;
    }
    replace(savedList, h('table', {},
      h('caption', { class: 'sr-only' }, '保存済みの月'),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, '月'), h('th', { scope: 'col' }, '保存日時'), h('th', { scope: 'col' }, 'ファイル'))),
      h('tbody', {}, saved.map((s) => h('tr', {},
        h('td', {}, formatMonth(s.month)),
        h('td', {}, formatDateTime(s.savedAt)),
        h('td', {}, REPORT_TYPES.map((type) => [
          h('a', { href: ctx.api.monthlyFileUrl(s.month, `${type}.csv`), download: '' }, `${REPORTS[type].code} CSV`),
          ' ',
          h('a', { href: ctx.api.monthlyFileUrl(s.month, `${type}.svg`), download: '' }, `${REPORTS[type].code} SVG`),
          '  ',
        ])))))));
  }

  async function saveMonth(target) {
    try {
      const result = await ctx.api.saveMonthly(target);
      saved = (await ctx.api.listMonthly()).items;
      drawSaved();
      ctx.message(`${formatMonth(result.month)}の集計を保存しました`, 'ok');
    } catch (err) {
      const errors = fieldErrors(err);
      if (errors.month) {
        month.setError(errors.month);
        month.control.focus();
      } else {
        ctx.message(describeError(err), 'error');
      }
    }
  }

  // 保存済みの月を保存し直すときは、上書きの確認を出す
  function confirmOverwrite(target) {
    const dialog = ctx.dialog;
    const form = h('form', { method: 'dialog',
      onsubmit: async (e) => {
        e.preventDefault();
        dialog.close();
        await saveMonth(target);
      } },
    h('h3', {}, '月次集計を保存'),
    h('p', {}, `${formatMonth(target)}は保存済みです。上書きします。`),
    h('div', { class: 'actions' },
      h('button', { type: 'submit', class: 'primary' }, '上書きして保存'),
      h('button', { type: 'button', onclick: () => dialog.close() }, 'キャンセル')));
    replace(dialog, form);
    dialog.showModal();
  }

  const saveButton = ctx.bindOperator(h('button', { type: 'button',
    onclick: async () => {
      if (!ctx.requireOperator()) return;
      const target = month.control.value;
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(target)) {
        month.setError('対象月を選択してください');
        month.control.focus();
        return;
      }
      month.setError('');
      if (saved.some((s) => s.month === target)) confirmOverwrite(target);
      else await saveMonth(target);
    } }, '月次集計を保存'));

  drawSaved();

  const controls = h('section', { class: 'panel', 'aria-labelledby': 'period-title' },
    h('h3', { id: 'period-title' }, '集計期間'),
    periodForm,
    h('p', { class: 'muted' }, '受付日時が期間内の問い合わせを集計します。対応時間は、平日 9:00〜18:00 のみを数え、保留の期間を除きます。'),
    h('hr', {}),
    h('h3', {}, '月次保存'),
    h('div', { class: 'row' }, month.el, h('div', { class: 'actions' }, saveButton)),
    h('h3', {}, '保存済みの月'),
    savedList);

  // ----- 集計 -----
  const total = summary.a06.reduce((sum, r) => sum + r.count, 0);
  const sections = total === 0
    ? h('p', { class: 'msg info' }, NO_DATA_MESSAGE)
    : REPORT_TYPES.map((type) => {
      const def = REPORTS[type];
      const headingId = `report-${type}`;
      const rows = def.rows(summary);
      return h('section', { class: 'panel', 'aria-labelledby': headingId },
        h('div', { class: 'actions', style: 'margin-top:0' },
          h('h3', { id: headingId, style: 'margin:0;flex:1' }, `${def.code} ${def.title}`),
          h('a', { class: 'button', href: ctx.api.reportCsvUrl(type, range.from, range.to), download: '' }, 'CSV出力')),
        h('div', { class: 'report-grid' },
          h('table', {},
            h('caption', { class: 'sr-only' }, `${def.code} ${def.title}`),
            h('thead', {}, h('tr', {}, def.headers.map((t, i) => h('th', { scope: 'col', class: i > 0 ? 'num' : '' }, t)))),
            h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: i > 0 ? 'num' : '' }, c)))))),
          svgFromString(renderReportChart(type, summary, { heading: false, idPrefix: `view-${type}` }))));
    });

  return h('div', {}, h('h2', {}, '集計'), controls, sections);
}
