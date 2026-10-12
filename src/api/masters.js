// マスタAPI(docs/api-design.md 4章・5.8)。削除APIは無い(無効化で扱う)。
import { conflict, notFound } from '../http/errors.js';
import { transaction } from '../db/transaction.js';
import { parseCategory, parseEmployee, parseMasterListQuery } from '../domain/validation.js';
import {
  categoryNameExists, countActiveStaff, countOpenAssigned, getCategory, getEmployee, insertCategory, insertEmployee,
  listCategories, listEmployees, updateCategory, updateEmployee,
} from '../repo/masters.js';
import { requireOperator } from './operator.js';

function parseId(params, label) {
  if (!/^\d+$/.test(params.id)) throw notFound(`${label}が見つかりません`);
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw notFound(`${label}が見つかりません`);
  return id;
}

const duplicateName = () =>
  conflict('DUPLICATE_NAME', '同じ名称のカテゴリがあります');

export const masterRoutes = [
  {
    method: 'GET',
    path: '/api/employees',
    handler: async ({ db, url }) => ({
      body: { items: listEmployees(db, parseMasterListQuery(url.searchParams, ['staff', 'active'])) },
    }),
  },

  {
    method: 'POST',
    path: '/api/employees',
    handler: async ({ db, req, readJson }) => {
      // 初期セットアップ: 有効な担当者が1人もいない間だけ、操作者なしで社員を追加できる
      // (でないと、誰も操作者になれず、最初の担当者を登録できない)。担当者がいれば、操作者が必須。
      if (countActiveStaff(db) > 0) requireOperator(db, req);
      const input = parseEmployee(await readJson());
      const id = insertEmployee(db, input);
      return { status: 201, body: getEmployee(db, id) };
    },
  },

  {
    method: 'PATCH',
    path: '/api/employees/:id',
    handler: async ({ db, req, params, readJson }) => {
      requireOperator(db, req);
      const id = parseId(params, '社員');
      const current = getEmployee(db, id);
      if (!current) throw notFound('社員が見つかりません');
      const input = parseEmployee(await readJson(), { partial: true });
      const next = { ...current, ...input };

      transaction(db, () => {
        // 未完了の問い合わせの担当者になっている社員は、無効にも、担当者区分を「一般」にもできない
        const deactivating = current.isActive && !next.isActive;
        const demoting = current.isStaff && !next.isStaff;
        if ((deactivating || demoting) && countOpenAssigned(db, id) > 0) {
          throw conflict(
            'HAS_OPEN_INQUIRIES',
            deactivating
              ? '未完了の問い合わせの担当者になっているため、無効にできません'
              : '未完了の問い合わせの担当者になっているため、担当者区分を変更できません',
          );
        }
        updateEmployee(db, id, next);
      });
      return { body: getEmployee(db, id) };
    },
  },

  {
    method: 'GET',
    path: '/api/categories',
    handler: async ({ db, url }) => ({
      body: { items: listCategories(db, parseMasterListQuery(url.searchParams, ['active'])) },
    }),
  },

  {
    method: 'POST',
    path: '/api/categories',
    handler: async ({ db, req, readJson }) => {
      requireOperator(db, req);
      const input = parseCategory(await readJson());
      const id = transaction(db, () => {
        if (categoryNameExists(db, input.name)) throw duplicateName();
        return insertCategory(db, input);
      });
      return { status: 201, body: getCategory(db, id) };
    },
  },

  {
    method: 'PATCH',
    path: '/api/categories/:id',
    handler: async ({ db, req, params, readJson }) => {
      requireOperator(db, req);
      const id = parseId(params, 'カテゴリ');
      const current = getCategory(db, id);
      if (!current) throw notFound('カテゴリが見つかりません');
      const input = parseCategory(await readJson(), { partial: true });
      const next = { ...current, ...input };

      transaction(db, () => {
        if (next.name !== current.name && categoryNameExists(db, next.name, id)) throw duplicateName();
        updateCategory(db, id, next);
      });
      return { body: getCategory(db, id) };
    },
  },
];
