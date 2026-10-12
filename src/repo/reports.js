// 集計(A-01〜A-06)。受付日時が期間(from〜to、両端を含む日付)内の問い合わせが対象。
// docs/api-design.md 5.9、docs/requirements.md 5.3。
import { STATUSES } from '../domain/status.js';

const UNASSIGNED = '未割当';

/** 'YYYY-MM-DD' から 'YYYY-MM' の一覧(両端を含む)を作る。 */
function monthsBetween(from, to) {
  const months = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

const byCountThenName = (nameKey) => (a, b) =>
  b.count - a.count || a[nameKey].localeCompare(b[nameKey], 'ja');

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} from 'YYYY-MM-DD'
 * @param {string} to 'YYYY-MM-DD'
 */
export function buildSummary(db, from, to) {
  const inquiries = db
    .prepare(`SELECT i.category_id, i.status, i.assignee_id, i.received_at, i.work_minutes,
                     r.department AS dept
                FROM inquiries i
                JOIN employees r ON r.id = i.requester_id
               WHERE i.received_at >= ? AND i.received_at <= ?`)
    .all(`${from} 00:00:00.000`, `${to} 23:59:59.999`);
  const categories = db
    .prepare('SELECT id, name, is_active FROM categories ORDER BY sort_order, id').all();
  const employees = db
    .prepare('SELECT id, name, department, is_staff, is_active FROM employees ORDER BY id').all();

  // A-01 カテゴリ別件数 / A-03 カテゴリ別平均対応時間
  // 有効なカテゴリは0件でも表示し、無効なカテゴリは期間内に件数があるときだけ表示する
  const categoryRows = categories
    .map((c) => {
      const mine = inquiries.filter((i) => i.category_id === c.id);
      const done = mine.filter((i) => i.status === '完了');
      return {
        category: c.name,
        active: c.is_active === 1,
        count: mine.length,
        doneCount: done.length,
        avgMinutes: done.length === 0
          ? null
          : Math.floor(done.reduce((sum, i) => sum + i.work_minutes, 0) / done.length),
      };
    })
    .filter((c) => c.active || c.count > 0);

  // A-02 部署別件数(依頼者の部署)。有効な社員がいる部署は0件でも表示する
  const depts = new Set(employees.filter((e) => e.is_active === 1).map((e) => e.department));
  inquiries.forEach((i) => depts.add(i.dept));
  const a02 = [...depts]
    .map((dept) => ({ dept, count: inquiries.filter((i) => i.dept === dept).length }))
    .sort(byCountThenName('dept'));

  // A-04 担当者別処理件数。有効な担当者と、期間内に担当した人。未割当の未完了があれば「未割当」の行
  const assigneeIds = new Set(employees.filter((e) => e.is_staff === 1 && e.is_active === 1).map((e) => e.id));
  inquiries.forEach((i) => { if (i.assignee_id !== null) assigneeIds.add(i.assignee_id); });
  const a04 = employees
    .filter((e) => assigneeIds.has(e.id))
    .map((e) => {
      const mine = inquiries.filter((i) => i.assignee_id === e.id);
      return {
        assignee: e.name,
        done: mine.filter((i) => i.status === '完了').length,
        open: mine.filter((i) => i.status !== '完了').length,
      };
    });
  const unassigned = inquiries.filter((i) => i.assignee_id === null);
  if (unassigned.length > 0) a04.push({ assignee: UNASSIGNED, done: 0, open: unassigned.length });

  // A-05 月別受付件数(期間内のすべての月を、0件の月も含めて並べる)
  const a05 = monthsBetween(from, to).map((month) => ({
    month,
    count: inquiries.filter((i) => i.received_at.startsWith(month)).length,
  }));

  // A-06 ステータス別件数(現在のステータス)
  const a06 = STATUSES.map((status) => ({ status, count: inquiries.filter((i) => i.status === status).length }));

  return {
    period: { from, to },
    a01: categoryRows.map((c) => ({ category: c.category, count: c.count })),
    a02,
    a03: categoryRows.map((c) => ({ category: c.category, doneCount: c.doneCount, avgMinutes: c.avgMinutes })),
    a04,
    a05,
    a06,
  };
}
