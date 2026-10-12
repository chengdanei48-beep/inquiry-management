// S-03 問い合わせ詳細(docs/screen-design.md 5章)。
import {
  focusFirstInvalid, formField, selectInput, statusBadge, textArea, textInput,
} from '../components.js';
import { h, replace } from '../dom.js';
import { formatDateTime, formatMinutes } from '../format.js';
import { describeError, fieldErrors } from '../messages.js';
import { availableTransitions, isLocked, PRIORITIES, transitionLabel } from '../status.js';
import { validateText } from '../validation.js';

const NOT_FOUND = '問い合わせが見つかりません';

/** 履歴1件の説明(日時・操作者は別に表示する)。 */
export function describeHistory(history) {
  switch (history.type) {
    case 'status': {
      const base = `ステータスを「${history.fromStatus}」から「${history.toStatus}」に変更`;
      return history.toStatus === '完了' && history.content ? `${base}(対応内容: ${history.content})` : base;
    }
    case 'comment':
      return `コメント: ${history.content}`;
    default:
      return history.content ?? '';
  }
}

export async function renderInquiryDetail(ctx, route) {
  const [initial, employees, categories] = await Promise.all([
    ctx.api.getInquiry(route.id),
    ctx.api.listEmployees(),
    ctx.api.listCategories(),
  ]);
  let detail = initial;
  let editing = false;

  const staff = employees.items.filter((e) => e.isStaff && e.isActive);
  const root = h('div', {});

  /** 操作の失敗を表示する。競合(409)のときは、再読み込みのボタンを添える。 */
  function showFailure(err) {
    const text = describeError(err, { notFound: NOT_FOUND });
    if (err.code === 'STALE_UPDATE') {
      ctx.message(text, 'error', { label: '再読み込み', onClick: () => ctx.refresh() });
    } else {
      ctx.message(text, 'error');
    }
  }

  /** 成功したら、応答の詳細で画面を更新する(全APIが更新後の詳細を返す)。 */
  async function run(action, successText) {
    try {
      detail = await action();
      editing = false;
      draw();
      ctx.message(successText, 'ok');
      return true;
    } catch (err) {
      showFailure(err);
      return false;
    }
  }

  // ----- 完了(対応内容の入力ダイアログ) -----
  function openCompleteDialog() {
    const resolution = formField('c-resolution', '対応内容', textInput(), { required: true, counter: true });
    const dialog = ctx.dialog;
    const submit = h('button', { type: 'submit', class: 'primary' }, '完了にする');
    const form = h('form', { novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        const { value, error } = validateText('対応内容', resolution.control.value);
        resolution.setError(error);
        if (error) { resolution.control.focus(); return; }
        submit.disabled = true;
        const ok = await run(
          () => ctx.api.changeStatus(detail.id, { status: '完了', resolution: value, updatedAt: detail.updatedAt }),
          '完了にしました',
        );
        if (ok) { dialog.close(); return; }
        submit.disabled = false;
        // 項目のエラー(対応内容の不備)は、ダイアログ内に表示する
      } },
    h('h3', {}, '完了にする'),
    h('p', {}, '完了にすると、元に戻せません。対応内容を入力してください。'),
    resolution.el,
    h('div', { class: 'actions' },
      submit,
      h('button', { type: 'button', onclick: () => dialog.close() }, 'キャンセル')));
    replace(dialog, form);
    dialog.showModal();
    resolution.control.focus();
  }

  // ----- ステータス変更 -----
  async function changeStatus(to) {
    if (!ctx.requireOperator()) return;
    if (!detail.assignee) {
      ctx.message('担当者を割り当ててください', 'error');
      return;
    }
    if (to === '完了') { openCompleteDialog(); return; }
    await run(
      () => ctx.api.changeStatus(detail.id, { status: to, updatedAt: detail.updatedAt }),
      `ステータスを「${to}」に変更しました`,
    );
  }

  // ----- 各パーツ -----
  function infoPanel() {
    const rows = [
      ['依頼者', `${detail.requester.name}(${detail.requester.dept})`],
      ['内容', detail.body],
      ['カテゴリ', detail.category.name],
      ['優先度', detail.priority],
      ['担当者', detail.assignee ? detail.assignee.name : '未割当'],
      ['受付日時', formatDateTime(detail.receivedAt)],
      ['更新日時', formatDateTime(detail.updatedAt)],
      ['関連する問い合わせ', detail.relatedInquiry
        ? h('a', { href: `#/inquiries/${detail.relatedInquiry.id}` }, `#${detail.relatedInquiry.id} ${detail.relatedInquiry.title}`)
        : 'なし'],
    ];
    if (isLocked(detail.status)) {
      rows.push(
        ['完了日時', formatDateTime(detail.completedAt)],
        ['対応内容', detail.resolution],
        ['対応時間', formatMinutes(detail.workMinutes)],
      );
    }
    return h('section', { class: 'panel', 'aria-labelledby': 'info-title' },
      h('h3', { id: 'info-title' }, '基本情報'),
      h('dl', { class: 'info' }, rows.map(([term, value]) => [h('dt', {}, term), h('dd', {}, value)])));
  }

  function editForm() {
    const title = formField('e-title', '件名', textInput(detail.title), { required: true, counter: true });
    const body = formField('e-body', '内容', textArea(detail.body, 3), { required: true, counter: true });
    // 無効になったカテゴリが設定されている場合も、現在の値として選べるようにする
    const options = categories.items
      .filter((c) => c.isActive || c.id === detail.category.id)
      .map((c) => ({ value: c.id, label: c.isActive ? c.name : `${c.name}(無効)` }));
    const category = formField('e-category', 'カテゴリ', selectInput(options, { value: detail.category.id }), { required: true });
    const priority = formField('e-priority', '優先度',
      selectInput(PRIORITIES.map((p) => ({ value: p, label: p })), { value: detail.priority }), { required: true });
    const submit = ctx.bindOperator(h('button', { type: 'submit', class: 'primary' }, '保存'));
    const form = h('form', { novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        if (!ctx.requireOperator()) return;
        const t = validateText('件名', title.control.value);
        const b = validateText('内容', body.control.value);
        title.setError(t.error);
        body.setError(b.error);
        if (t.error || b.error) { focusFirstInvalid(form); return; }
        submit.disabled = true;
        try {
          detail = await ctx.api.updateInquiry(detail.id, {
            title: t.value, body: b.value, categoryId: Number(category.control.value),
            priority: priority.control.value, updatedAt: detail.updatedAt,
          });
          editing = false;
          draw();
          ctx.message('保存しました', 'ok');
        } catch (err) {
          const serverErrors = fieldErrors(err);
          const map = { title, body, categoryId: category, priority };
          const keys = Object.keys(serverErrors).filter((k) => map[k]);
          if (keys.length > 0) {
            keys.forEach((k) => map[k].setError(serverErrors[k]));
            focusFirstInvalid(form);
          } else {
            showFailure(err);
          }
          submit.disabled = ctx.operatorId === null;
        }
      } },
    title.el, body.el, category.el, priority.el,
    h('div', { class: 'actions' },
      submit,
      h('button', { type: 'button', onclick: () => { editing = false; draw(); } }, 'キャンセル')));
    return form;
  }

  function operationsPanel() {
    let content;
    if (isLocked(detail.status)) {
      content = h('div', {},
        h('p', { class: 'msg info' }, '完了済みのため編集できません。再度の対応が必要な場合は、新規に登録してください。'),
        h('a', { class: 'button', href: '#/inquiries/new' }, '新規登録へ'));
    } else if (editing) {
      content = editForm();
    } else {
      const assignee = formField('d-assignee', '担当者',
        selectInput([{ value: '', label: '選択してください' }, ...staff.map((e) => ({ value: e.id, label: e.name }))],
          { value: detail.assignee ? detail.assignee.id : '' }));
      const assignButton = ctx.bindOperator(h('button', { type: 'button',
        onclick: async () => {
          if (!ctx.requireOperator()) return;
          if (assignee.control.value === '') {
            assignee.setError('担当者を選択してください');
            assignee.control.focus();
            return;
          }
          assignee.setError('');
          await run(
            () => ctx.api.changeAssignee(detail.id, { assigneeId: Number(assignee.control.value), updatedAt: detail.updatedAt }),
            '担当者を割り当てました',
          );
        } }, '割り当てる'));
      content = h('div', {},
        // 遷移できないボタンは表示しない
        h('div', { class: 'actions' }, availableTransitions(detail.status).map((to) =>
          ctx.bindOperator(h('button', {
            type: 'button', class: to === '完了' ? 'primary' : '', onclick: () => changeStatus(to),
          }, transitionLabel(detail.status, to))))),
        h('div', { class: 'row' }, assignee.el, h('div', { class: 'actions' }, assignButton)),
        h('div', { class: 'actions' },
          ctx.bindOperator(h('button', { type: 'button', onclick: () => { editing = true; draw(); } }, '編集'))));
    }
    return h('section', { class: 'panel', 'aria-labelledby': 'ops-title' }, h('h3', { id: 'ops-title' }, '操作'), content);
  }

  function historyPanel() {
    const comment = formField('d-comment', 'コメント', textInput(), { counter: true });
    const add = ctx.bindOperator(h('button', { type: 'submit' }, '追加'));
    const form = h('form', { novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        if (!ctx.requireOperator()) return;
        const { value, error } = validateText('コメント', comment.control.value);
        comment.setError(error);
        if (error) { comment.control.focus(); return; }
        add.disabled = true;
        const ok = await run(() => ctx.api.addComment(detail.id, { text: value }), 'コメントを追加しました');
        if (!ok) add.disabled = ctx.operatorId === null;
      } },
    comment.el,
    h('div', { class: 'actions' }, add));

    return h('section', { class: 'panel', 'aria-labelledby': 'history-title' },
      h('h3', { id: 'history-title' }, '対応履歴(古い順)'),
      h('ul', { class: 'history' }, detail.histories.map((x) => h('li', {},
        h('span', { class: 'when' }, formatDateTime(x.at)),
        h('strong', {}, x.operator.name),
        '  ',
        describeHistory(x)))),
      form);
  }

  function draw() {
    replace(root,
      h('h2', {}, `#${detail.id} ${detail.title} `, statusBadge(detail.status)),
      infoPanel(),
      operationsPanel(),
      historyPanel(),
      h('p', {}, h('a', { href: ctx.listHash }, '一覧へ戻る')));
  }

  draw();
  return root;
}
