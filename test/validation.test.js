import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDateString, MAX_TEXT_LENGTH, parseAssigneeChange, parseCategory, parseComment, parseDateRange,
  parseEmployee, parseInquiryCreate, parseInquiryPatch, parseMonth, parseStatusChange, textLength,
} from '../src/domain/validation.js';

const UPDATED = '2026-10-12 09:30:00.000';
const valid = {
  title: 'VPNに接続できない', body: '在宅勤務で接続不可', requesterId: 8, categoryId: 1, priority: '高',
};

// 検証エラーを捕まえて { field → message } にする
function errorsOf(fn) {
  try {
    fn();
  } catch (e) {
    assert.equal(e.status, 400);
    assert.equal(e.code, 'VALIDATION_ERROR');
    return Object.fromEntries(e.fields.map((f) => [f.field, f.message]));
  }
  assert.fail('エラーになるはずの入力が通った');
}

test('文字数: 50文字は通り、51文字は拒否される(件名・内容)', () => {
  assert.equal(MAX_TEXT_LENGTH, 50);
  const ok = parseInquiryCreate({ ...valid, title: 'あ'.repeat(50), body: 'い'.repeat(50) });
  assert.equal(textLength(ok.title), 50);
  const errors = errorsOf(() => parseInquiryCreate({ ...valid, title: 'あ'.repeat(51), body: 'い'.repeat(51) }));
  assert.equal(errors.title, '件名は50文字以内で入力してください');
  assert.equal(errors.body, '内容は50文字以内で入力してください');
});

test('文字数: 前後の空白は除いて数え、保存する値からも除く', () => {
  const v = parseInquiryCreate({ ...valid, title: `  ${'あ'.repeat(50)}  ` });
  assert.equal(v.title, 'あ'.repeat(50));
});

test('文字数: サロゲートペア(絵文字など)は1文字として数える', () => {
  assert.equal(textLength('😀'.repeat(50)), 50);
  assert.doesNotThrow(() => parseComment({ text: '😀'.repeat(50) }));
  assert.throws(() => parseComment({ text: '😀'.repeat(51) }));
});

test('必須: 未入力・空白のみ・null は「を入力してください」', () => {
  for (const title of [undefined, null, '', '   ', '　']) {
    const errors = errorsOf(() => parseInquiryCreate({ ...valid, title }));
    assert.equal(errors.title, '件名を入力してください', JSON.stringify(title));
  }
});

test('型: 文字列でない値は拒否される', () => {
  const errors = errorsOf(() => parseInquiryCreate({ ...valid, title: 123, body: { a: 1 } }));
  assert.equal(errors.title, '件名は文字で入力してください');
  assert.equal(errors.body, '内容は文字で入力してください');
});

test('問い合わせ登録: 全項目の未入力は項目ごとのエラーになる(入力順)', () => {
  const e = (() => {
    try { parseInquiryCreate({}); } catch (err) { return err; }
    return null;
  })();
  assert.deepEqual(e.fields.map((f) => f.field), ['title', 'body', 'requesterId', 'categoryId', 'priority']);
  assert.equal(e.fields[2].message, '依頼者を選択してください');
  assert.equal(e.fields[3].message, 'カテゴリを選択してください');
  assert.equal(e.fields[4].message, '優先度を選択してください');
});

test('問い合わせ登録: 正常な入力は整形されて返り、関連IDは省略できる', () => {
  assert.deepEqual(parseInquiryCreate(valid), { ...valid, relatedInquiryId: null });
  assert.equal(parseInquiryCreate({ ...valid, relatedInquiryId: 3 }).relatedInquiryId, 3);
  assert.equal(parseInquiryCreate({ ...valid, requesterId: '8', relatedInquiryId: '3' }).requesterId, 8);
});

test('ID: 0・負数・小数・文字は拒否される', () => {
  for (const requesterId of [0, -1, 1.5, 'abc', '1.5', true, [], NaN]) {
    const errors = errorsOf(() => parseInquiryCreate({ ...valid, requesterId }));
    assert.ok(errors.requesterId, JSON.stringify(requesterId));
  }
  const errors = errorsOf(() => parseInquiryCreate({ ...valid, relatedInquiryId: 0 }));
  assert.ok(errors.relatedInquiryId);
});

test('選択肢: 優先度は 高・中・低 のみ', () => {
  for (const priority of ['最高', '', 'high', 1]) {
    assert.ok(errorsOf(() => parseInquiryCreate({ ...valid, priority })).priority, String(priority));
  }
  for (const priority of ['高', '中', '低']) {
    assert.equal(parseInquiryCreate({ ...valid, priority }).priority, priority);
  }
});

test('問い合わせ編集: 指定した項目だけを検証し、更新日時は必須', () => {
  assert.deepEqual(parseInquiryPatch({ title: '新しい件名', updatedAt: UPDATED }), { title: '新しい件名', updatedAt: UPDATED });
  assert.deepEqual(
    parseInquiryPatch({ priority: '低', categoryId: 2, updatedAt: UPDATED }),
    { priority: '低', categoryId: 2, updatedAt: UPDATED },
  );
  assert.ok(errorsOf(() => parseInquiryPatch({ title: 'あ'.repeat(51), updatedAt: UPDATED })).title);
  assert.ok(errorsOf(() => parseInquiryPatch({ title: '', updatedAt: UPDATED })).title);
  assert.ok(errorsOf(() => parseInquiryPatch({ title: '件名' })).updatedAt);
  assert.ok(errorsOf(() => parseInquiryPatch({ title: '件名', updatedAt: '2026/10/12' })).updatedAt);
});

test('問い合わせ編集: 変更する項目が1つも無ければ拒否される', () => {
  const errors = errorsOf(() => parseInquiryPatch({ updatedAt: UPDATED }));
  assert.equal(errors.title, '変更する項目を指定してください');
});

test('ステータス変更: 完了のときだけ対応内容(必須・50文字以内)を検証する', () => {
  assert.deepEqual(
    parseStatusChange({ status: '対応中', updatedAt: UPDATED }),
    { status: '対応中', resolution: null, updatedAt: UPDATED },
  );
  // 完了以外では、対応内容が付いていても使わない
  assert.equal(parseStatusChange({ status: '保留', resolution: '無視される', updatedAt: UPDATED }).resolution, null);
  assert.equal(
    parseStatusChange({ status: '完了', resolution: '再起動した', updatedAt: UPDATED }).resolution,
    '再起動した',
  );
  assert.equal(
    errorsOf(() => parseStatusChange({ status: '完了', updatedAt: UPDATED })).resolution,
    '対応内容を入力してください',
  );
  assert.equal(
    errorsOf(() => parseStatusChange({ status: '完了', resolution: 'あ'.repeat(51), updatedAt: UPDATED })).resolution,
    '対応内容は50文字以内で入力してください',
  );
  assert.doesNotThrow(() => parseStatusChange({ status: '完了', resolution: 'あ'.repeat(50), updatedAt: UPDATED }));
});

test('ステータス変更: 不明なステータス・更新日時なしは拒否される', () => {
  assert.ok(errorsOf(() => parseStatusChange({ status: '削除', updatedAt: UPDATED })).status);
  assert.ok(errorsOf(() => parseStatusChange({ updatedAt: UPDATED })).status);
  assert.ok(errorsOf(() => parseStatusChange({ status: '対応中' })).updatedAt);
});

test('担当者変更: 担当者と更新日時が必須', () => {
  assert.deepEqual(parseAssigneeChange({ assigneeId: 2, updatedAt: UPDATED }), { assigneeId: 2, updatedAt: UPDATED });
  assert.equal(errorsOf(() => parseAssigneeChange({ updatedAt: UPDATED })).assigneeId, '担当者を選択してください');
  assert.ok(errorsOf(() => parseAssigneeChange({ assigneeId: 2 })).updatedAt);
});

test('コメント: 必須・50文字以内', () => {
  assert.deepEqual(parseComment({ text: ' 再起動を依頼した ' }), { text: '再起動を依頼した' });
  assert.equal(errorsOf(() => parseComment({})).text, 'コメントを入力してください');
  assert.equal(errorsOf(() => parseComment({ text: 'あ'.repeat(51) })).text, 'コメントは50文字以内で入力してください');
});

test('社員: 追加時は氏名・部署が必須で、担当者区分は省略すると一般', () => {
  assert.deepEqual(parseEmployee({ name: '山田 太郎', department: '情報システム' }), {
    name: '山田 太郎', department: '情報システム', isStaff: false,
  });
  assert.equal(parseEmployee({ name: 'a', department: 'b', isStaff: true }).isStaff, true);
  const errors = errorsOf(() => parseEmployee({}));
  assert.equal(errors.name, '氏名を入力してください');
  assert.equal(errors.department, '部署を入力してください');
  assert.ok(errorsOf(() => parseEmployee({ name: 'a', department: 'b', isStaff: 'yes' })).isStaff);
  assert.ok(errorsOf(() => parseEmployee({ name: 'あ'.repeat(51), department: 'b' })).name);
});

test('社員: 編集は指定した項目だけを検証し、1項目も無ければ拒否される', () => {
  assert.deepEqual(parseEmployee({ isActive: false }, { partial: true }), { isActive: false });
  assert.deepEqual(parseEmployee({ isStaff: false }, { partial: true }), { isStaff: false });
  assert.ok(errorsOf(() => parseEmployee({}, { partial: true })).name);
  assert.ok(errorsOf(() => parseEmployee({ name: '' }, { partial: true })).name);
  assert.ok(errorsOf(() => parseEmployee({ isActive: 'no' }, { partial: true })).isActive);
});

test('カテゴリ: 名称は必須・50文字以内、表示順は0以上の整数', () => {
  assert.deepEqual(parseCategory({ name: 'その他', sortOrder: 5 }), { name: 'その他', sortOrder: 5 });
  assert.equal(parseCategory({ name: 'その他', sortOrder: '5' }).sortOrder, 5);
  const errors = errorsOf(() => parseCategory({ name: '', sortOrder: -1 }));
  assert.equal(errors.name, '名称を入力してください');
  assert.equal(errors.sortOrder, '表示順は0以上の整数で入力してください');
  assert.ok(errorsOf(() => parseCategory({ name: 'あ'.repeat(51), sortOrder: 1 })).name);
  assert.ok(errorsOf(() => parseCategory({ name: 'a', sortOrder: 1.5 })).sortOrder);
  assert.deepEqual(parseCategory({ isActive: false }, { partial: true }), { isActive: false });
});

test('日付: 実在する日付だけが通る', () => {
  assert.equal(isDateString('2026-10-12'), true);
  assert.equal(isDateString('2028-02-29'), true);
  for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026/10/12', '2026-1-2', '', null]) {
    assert.equal(isDateString(bad), false, String(bad));
  }
});

test('集計期間: 開始日・終了日が必須で、開始日が終了日より後は拒否される', () => {
  assert.deepEqual(parseDateRange({ from: '2026-07-01', to: '2026-10-12' }), { from: '2026-07-01', to: '2026-10-12' });
  assert.doesNotThrow(() => parseDateRange({ from: '2026-10-12', to: '2026-10-12' }));
  assert.equal(errorsOf(() => parseDateRange({ from: '2026-10-13', to: '2026-10-12' })).from, '開始日は終了日以前の日付にしてください');
  const missing = errorsOf(() => parseDateRange({}));
  assert.equal(missing.from, '開始日を入力してください');
  assert.equal(missing.to, '終了日を入力してください');
  assert.equal(errorsOf(() => parseDateRange({ from: '2026-02-30', to: '2026-03-01' })).from, '開始日を正しく入力してください');
});

test('対象月: YYYY-MM の形だけが通る', () => {
  assert.equal(parseMonth('2026-09'), '2026-09');
  for (const bad of ['2026-13', '2026-00', '2026/09', '2026-9', '', null, 202609]) {
    assert.throws(() => parseMonth(bad), (e) => e.code === 'VALIDATION_ERROR', String(bad));
  }
});

test('エラーの形式: 設計書の VALIDATION_ERROR(400)', () => {
  try {
    parseInquiryCreate({});
    assert.fail('投げられるはず');
  } catch (e) {
    assert.equal(e.status, 400);
    assert.equal(e.code, 'VALIDATION_ERROR');
    assert.equal(e.message, '入力内容を確認してください');
    assert.ok(Array.isArray(e.fields) && e.fields.every((f) => f.field && f.message));
  }
});
