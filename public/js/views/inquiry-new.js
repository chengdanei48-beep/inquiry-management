// S-02 問い合わせ登録(docs/screen-design.md 4章)。
import { focusFirstInvalid, formField, selectInput, textArea, textInput } from '../components.js';
import { h } from '../dom.js';
import { describeError, fieldErrors } from '../messages.js';
import { PRIORITIES } from '../status.js';
import { parseOptionalId, validateChoice, validateText } from '../validation.js';

export async function renderInquiryNew(ctx) {
  const [employees, categories] = await Promise.all([
    ctx.api.listEmployees({ active: '1' }),
    ctx.api.listCategories({ active: '1' }),
  ]);

  const fields = {
    title: formField('n-title', '件名', textInput(), { required: true, counter: true }),
    body: formField('n-body', '内容', textArea('', 3), { required: true, counter: true }),
    requesterId: formField('n-requester', '依頼者',
      selectInput(employees.items.map((e) => ({ value: e.id, label: `${e.name}(${e.department})` })), { placeholder: '選択してください' }),
      { required: true }),
    categoryId: formField('n-category', 'カテゴリ',
      selectInput(categories.items.map((c) => ({ value: c.id, label: c.name })), { placeholder: '選択してください' }),
      { required: true }),
    priority: formField('n-priority', '優先度',
      selectInput(PRIORITIES.map((p) => ({ value: p, label: p })), { value: '中' }), { required: true }),
    relatedInquiryId: formField('n-related', '関連する問い合わせ(ID)', h('input', { type: 'number', min: '1', step: '1' })),
  };
  const get = (key) => fields[key].control.value;

  const submit = ctx.bindOperator(h('button', { type: 'submit', class: 'primary' }, '登録'));

  const form = h('form', { class: 'panel', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      if (!ctx.requireOperator()) return;
      Object.values(fields).forEach((f) => f.setError(''));

      // 送信前の検証(サーバーでも同じ検証を行う)
      const title = validateText('件名', get('title'));
      const body = validateText('内容', get('body'));
      const related = parseOptionalId('関連する問い合わせ', get('relatedInquiryId'));
      const errors = {
        title: title.error,
        body: body.error,
        requesterId: validateChoice('依頼者', get('requesterId')),
        categoryId: validateChoice('カテゴリ', get('categoryId')),
        priority: validateChoice('優先度', get('priority')),
        relatedInquiryId: related.error,
      };
      const invalid = Object.entries(errors).filter(([, msg]) => msg);
      invalid.forEach(([key, msg]) => fields[key].setError(msg));
      if (invalid.length > 0) {
        focusFirstInvalid(form);
        return;
      }

      submit.disabled = true;
      try {
        const created = await ctx.api.createInquiry({
          title: title.value,
          body: body.value,
          requesterId: Number(get('requesterId')),
          categoryId: Number(get('categoryId')),
          priority: get('priority'),
          relatedInquiryId: related.value,
        });
        ctx.flash('問い合わせを登録しました', 'ok');
        ctx.navigate(`#/inquiries/${created.id}`);
      } catch (err) {
        // サーバーの項目エラーは、該当項目の下に表示する
        const serverErrors = fieldErrors(err);
        const keys = Object.keys(serverErrors).filter((k) => fields[k]);
        if (keys.length > 0) {
          keys.forEach((k) => fields[k].setError(serverErrors[k]));
          focusFirstInvalid(form);
        } else {
          ctx.message(describeError(err), 'error');
        }
      } finally {
        submit.disabled = ctx.operatorId === null;
      }
    } },
  Object.values(fields).map((f) => f.el),
  h('div', { class: 'actions' },
    submit,
    h('a', { class: 'button', href: ctx.listHash }, 'キャンセル')));

  return h('div', {}, h('h2', {}, '問い合わせ登録'), form);
}
