import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCanChangeStatus, assertNotLocked, availableTransitions, canTransition, isLocked, STATUSES,
} from '../src/domain/status.js';

const ALLOWED = new Set(['未対応>対応中', '対応中>保留', '保留>対応中', '対応中>完了']);

test('遷移: 4×4 のすべての組み合わせが設計書どおり', () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      assert.equal(canTransition(from, to), ALLOWED.has(`${from}>${to}`), `${from} → ${to}`);
    }
  }
});

test('遷移: 完了は最終状態(再開できない)', () => {
  assert.deepEqual(availableTransitions('完了'), []);
  assert.equal(canTransition('完了', '対応中'), false);
});

test('遷移: 画面のボタンの出し分け', () => {
  assert.deepEqual(availableTransitions('未対応'), ['対応中']);
  assert.deepEqual(availableTransitions('対応中'), ['保留', '完了']);
  assert.deepEqual(availableTransitions('保留'), ['対応中']);
  assert.deepEqual(availableTransitions('存在しない'), []);
});

test('遷移: 返した配列を変更しても、元の定義は変わらない', () => {
  availableTransitions('対応中').push('未対応');
  assert.deepEqual(availableTransitions('対応中'), ['保留', '完了']);
});

test('ロック: 完了のときだけ編集できない(COMPLETED_LOCKED)', () => {
  assert.equal(isLocked('完了'), true);
  for (const s of ['未対応', '対応中', '保留']) {
    assert.equal(isLocked(s), false);
    assert.doesNotThrow(() => assertNotLocked(s));
  }
  assert.throws(() => assertNotLocked('完了'), (e) => e.status === 409 && e.code === 'COMPLETED_LOCKED');
});

test('変更の可否: 正常な遷移', () => {
  assert.doesNotThrow(() => assertCanChangeStatus({ from: '未対応', to: '対応中', assigneeId: 1 }));
  assert.doesNotThrow(() => assertCanChangeStatus({ from: '対応中', to: '保留', assigneeId: 1 }));
  assert.doesNotThrow(() => assertCanChangeStatus({ from: '保留', to: '対応中', assigneeId: 1 }));
  assert.doesNotThrow(() => assertCanChangeStatus({ from: '対応中', to: '完了', assigneeId: 1, resolution: '再起動した' }));
});

test('変更の可否: 不正な遷移は 409 INVALID_TRANSITION', () => {
  for (const [from, to] of [['未対応', '完了'], ['完了', '対応中'], ['未対応', '保留'], ['保留', '完了'], ['対応中', '未対応']]) {
    assert.throws(
      () => assertCanChangeStatus({ from, to, assigneeId: 1, resolution: '済' }),
      (e) => e.status === 409 && e.code === 'INVALID_TRANSITION',
      `${from} → ${to}`,
    );
  }
});

test('変更の可否: 担当者が未割当なら 409 ASSIGNEE_REQUIRED', () => {
  for (const assigneeId of [null, undefined]) {
    assert.throws(
      () => assertCanChangeStatus({ from: '未対応', to: '対応中', assigneeId }),
      (e) => e.status === 409 && e.code === 'ASSIGNEE_REQUIRED' && e.message === '担当者を割り当ててください',
    );
  }
});

test('変更の可否: 完了時に対応内容が無ければ 400 VALIDATION_ERROR(項目 resolution)', () => {
  for (const resolution of [undefined, null, '']) {
    assert.throws(
      () => assertCanChangeStatus({ from: '対応中', to: '完了', assigneeId: 1, resolution }),
      (e) => e.status === 400 && e.code === 'VALIDATION_ERROR'
        && e.fields[0].field === 'resolution' && e.fields[0].message === '対応内容を入力してください',
    );
  }
});

test('変更の可否: 判定の順序は 遷移 → 担当者 → 対応内容', () => {
  // 遷移が不正なら、担当者・対応内容が無くても INVALID_TRANSITION
  assert.throws(
    () => assertCanChangeStatus({ from: '未対応', to: '完了', assigneeId: null }),
    (e) => e.code === 'INVALID_TRANSITION',
  );
  // 遷移が正しく担当者も無ければ ASSIGNEE_REQUIRED(対応内容より先)
  assert.throws(
    () => assertCanChangeStatus({ from: '対応中', to: '完了', assigneeId: null }),
    (e) => e.code === 'ASSIGNEE_REQUIRED',
  );
});
