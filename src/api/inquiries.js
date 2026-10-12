// 問い合わせAPI(docs/api-design.md 4章・5.1〜5.7)。
// 変更系の処理順: 操作者(400) → 対象の存在(404) → 入力検証(400) → 更新日時の確認(409)
//               → 状態・業務ルール(409) → 更新と履歴を1トランザクションで保存。
import { conflict, notFound, validationError } from '../http/errors.js';
import { transaction } from '../db/transaction.js';
import { laterOf, workMinutes } from '../domain/time.js';
import { assertCanChangeStatus, assertNotLocked } from '../domain/status.js';
import {
  parseAssigneeChange, parseComment, parseInquiryCreate, parseInquiryListQuery,
  parseInquiryPatch, parseStatusChange,
} from '../domain/validation.js';
import {
  findCategory, findEmployee, findInquiry, getDetail, getHistories, insertHistory,
  insertInquiry, listAllInquiries, listInquiries, updateInquiryIfUnchanged,
} from '../repo/inquiries.js';
import { toCsv } from '../domain/csv.js';
import { sendCsv } from '../http/respond.js';
import { formatMinutes } from '../../public/js/report-tables.js';
import { requireOperator } from './operator.js';

const staleUpdate = () =>
  conflict('STALE_UPDATE', '他の担当者が先に更新しました。最新の内容を読み込み直してください');

/** パスの {id}(正の整数)。数字でなければ存在しないものとして 404。 */
function parseId(params) {
  if (!/^\d+$/.test(params.id)) throw notFound('問い合わせが見つかりません');
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw notFound('問い合わせが見つかりません');
  return id;
}

function loadInquiry(db, params) {
  const id = parseId(params);
  const row = findInquiry(db, id);
  if (!row) throw notFound('問い合わせが見つかりません');
  return row;
}

function assertFresh(row, expectedUpdatedAt) {
  if (row.updated_at !== expectedUpdatedAt) throw staleUpdate();
}

/** 有効な社員か。そうでなければ項目のエラー(400)。 */
function assertActiveEmployee(db, id, field, label) {
  const e = findEmployee(db, id);
  if (!e || !e.is_active) throw validationError([{ field, message: `${label}を選択してください` }]);
  return e;
}

function assertActiveCategory(db, id) {
  const c = findCategory(db, id);
  if (!c || !c.is_active) throw validationError([{ field: 'categoryId', message: 'カテゴリを選択してください' }]);
  return c;
}

/** 更新に失敗(他の更新が先に入った)したら 409。 */
function mustUpdate(updated) {
  if (!updated) throw staleUpdate();
}

export const inquiryRoutes = [
  {
    method: 'GET',
    path: '/api/inquiries',
    handler: async ({ db, url }) => ({ body: listInquiries(db, parseInquiryListQuery(url.searchParams)) }),
  },

  {
    // 一覧と同じ絞り込み・並び順で、条件に合う全件を出力する(page は無視する)。`:id` より先に登録する。
    method: 'GET',
    path: '/api/inquiries/export.csv',
    handler: async ({ db, res, url, now }) => {
      const items = listAllInquiries(db, parseInquiryListQuery(url.searchParams));
      const rows = items.map((i) => [
        i.id, i.title, i.body, i.category.name, i.requester.name, i.requester.dept, i.priority, i.status,
        i.assignee ? i.assignee.name : '', i.receivedAt, i.completedAt ?? '', i.resolution ?? '',
        formatMinutes(i.workMinutes, ''),
      ]);
      const csv = toCsv(
        ['ID', '件名', '内容', 'カテゴリ', '依頼者', '部署', '優先度', 'ステータス', '担当者', '受付日時', '完了日時', '対応内容', '対応時間'],
        rows,
      );
      sendCsv(res, `inquiries-${now().slice(0, 10).replaceAll('-', '')}.csv`, csv);
    },
  },

  {
    method: 'POST',
    path: '/api/inquiries',
    handler: async ({ db, req, readJson, now }) => {
      const operator = requireOperator(db, req);
      const input = parseInquiryCreate(await readJson());
      assertActiveEmployee(db, input.requesterId, 'requesterId', '依頼者');
      assertActiveCategory(db, input.categoryId);
      if (input.relatedInquiryId !== null && !findInquiry(db, input.relatedInquiryId)) {
        throw validationError([{ field: 'relatedInquiryId', message: '指定した問い合わせが見つかりません' }]);
      }
      const at = now();
      const id = transaction(db, () => {
        const newId = insertInquiry(db, { ...input, now: at });
        insertHistory(db, { inquiryId: newId, type: 'registered', content: '問い合わせを登録しました', operatorId: operator.id, at });
        return newId;
      });
      return { status: 201, body: getDetail(db, id) };
    },
  },

  {
    method: 'GET',
    path: '/api/inquiries/:id',
    handler: async ({ db, params }) => {
      const detail = getDetail(db, parseId(params));
      if (!detail) throw notFound('問い合わせが見つかりません');
      return { body: detail };
    },
  },

  {
    method: 'PATCH',
    path: '/api/inquiries/:id',
    handler: async ({ db, req, params, readJson, now }) => {
      const operator = requireOperator(db, req);
      const row = loadInquiry(db, params);
      const input = parseInquiryPatch(await readJson());
      assertFresh(row, input.updatedAt);
      assertNotLocked(row.status);
      // 後から無効になったカテゴリの問い合わせも、カテゴリを変えない編集はできる(変更するときだけ有効かを確認する)
      if (input.categoryId !== undefined && input.categoryId !== row.category_id) assertActiveCategory(db, input.categoryId);

      const LABELS = { title: '件名', body: '内容', category_id: 'カテゴリ', priority: '優先度' };
      const changes = {};
      if (input.title !== undefined && input.title !== row.title) changes.title = input.title;
      if (input.body !== undefined && input.body !== row.body) changes.body = input.body;
      if (input.categoryId !== undefined && input.categoryId !== row.category_id) changes.category_id = input.categoryId;
      if (input.priority !== undefined && input.priority !== row.priority) changes.priority = input.priority;

      // 変更が無ければ何も更新しない(履歴も残さない)
      if (Object.keys(changes).length > 0) {
        const at = laterOf(now(), row.updated_at);
        transaction(db, () => {
          mustUpdate(updateInquiryIfUnchanged(db, row.id, row.updated_at, { ...changes, updated_at: at }));
          insertHistory(db, {
            inquiryId: row.id, type: 'edit', operatorId: operator.id, at,
            content: `${Object.keys(changes).map((c) => LABELS[c]).join('・')}を編集`,
          });
        });
      }
      return { body: getDetail(db, row.id) };
    },
  },

  {
    method: 'POST',
    path: '/api/inquiries/:id/status',
    handler: async ({ db, req, params, readJson, now }) => {
      const operator = requireOperator(db, req);
      const row = loadInquiry(db, params);
      const input = parseStatusChange(await readJson());
      assertFresh(row, input.updatedAt);
      assertCanChangeStatus({
        from: row.status, to: input.status, assigneeId: row.assignee_id, resolution: input.resolution,
      });

      const at = laterOf(now(), row.updated_at);
      const changes = { status: input.status, updated_at: at };
      transaction(db, () => {
        if (input.status === '完了') {
          changes.completed_at = at;
          changes.resolution = input.resolution;
          changes.work_minutes = workMinutes({
            receivedAt: row.received_at, completedAt: at, histories: getHistories(db, row.id).map((h) => ({
              type: h.type, from_status: h.fromStatus, to_status: h.toStatus, at: h.at,
            })),
          });
        }
        mustUpdate(updateInquiryIfUnchanged(db, row.id, row.updated_at, changes));
        insertHistory(db, {
          inquiryId: row.id, type: 'status', fromStatus: row.status, toStatus: input.status,
          content: input.status === '完了' ? input.resolution : null, operatorId: operator.id, at,
        });
      });
      return { body: getDetail(db, row.id) };
    },
  },

  {
    method: 'POST',
    path: '/api/inquiries/:id/assignee',
    handler: async ({ db, req, params, readJson, now }) => {
      const operator = requireOperator(db, req);
      const row = loadInquiry(db, params);
      const input = parseAssigneeChange(await readJson());
      assertFresh(row, input.updatedAt);
      assertNotLocked(row.status);
      const assignee = findEmployee(db, input.assigneeId);
      // 担当者は、有効な「担当者」区分の社員のみ(外部キーでは保証できないためここで検証する)
      if (!assignee || !assignee.is_active || !assignee.is_staff) {
        throw validationError([{ field: 'assigneeId', message: '担当者を選択してください' }]);
      }

      // 同じ担当者なら何も更新しない
      if (row.assignee_id !== assignee.id) {
        const previous = row.assignee_id === null ? null : findEmployee(db, row.assignee_id);
        const at = laterOf(now(), row.updated_at);
        transaction(db, () => {
          mustUpdate(updateInquiryIfUnchanged(db, row.id, row.updated_at, { assignee_id: assignee.id, updated_at: at }));
          insertHistory(db, {
            inquiryId: row.id, type: 'assignee', operatorId: operator.id, at,
            content: previous
              ? `担当者を「${previous.name}」から「${assignee.name}」に変更`
              : `担当者を「${assignee.name}」に設定`,
          });
        });
      }
      return { body: getDetail(db, row.id) };
    },
  },

  {
    method: 'POST',
    path: '/api/inquiries/:id/comments',
    handler: async ({ db, req, params, readJson, now }) => {
      const operator = requireOperator(db, req);
      const row = loadInquiry(db, params);
      const input = parseComment(await readJson());
      // コメントは競合の対象外。履歴だけを追加し、問い合わせの更新日時は変えない。完了後も追加できる。
      insertHistory(db, { inquiryId: row.id, type: 'comment', content: input.text, operatorId: operator.id, at: now() });
      return { status: 201, body: getDetail(db, row.id) };
    },
  },
];
