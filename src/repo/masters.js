// 社員・カテゴリのDBアクセス。SQLの値はすべてプレースホルダ(?)で渡す。

const toEmployee = (r) => ({
  id: r.id,
  name: r.name,
  department: r.department,
  isStaff: r.is_staff === 1,
  isActive: r.is_active === 1,
});

const toCategory = (r) => ({
  id: r.id,
  name: r.name,
  sortOrder: r.sort_order,
  isActive: r.is_active === 1,
});

/** @param {{staff?: boolean, active?: boolean}} f */
export function listEmployees(db, f = {}) {
  const where = [];
  const params = [];
  if (f.staff !== undefined) { where.push('is_staff = ?'); params.push(f.staff ? 1 : 0); }
  if (f.active !== undefined) { where.push('is_active = ?'); params.push(f.active ? 1 : 0); }
  const sql = `SELECT id, name, department, is_staff, is_active FROM employees
               ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`;
  return db.prepare(sql).all(...params).map(toEmployee);
}

export function getEmployee(db, id) {
  const r = db.prepare('SELECT id, name, department, is_staff, is_active FROM employees WHERE id = ?').get(id);
  return r ? toEmployee(r) : null;
}

export function insertEmployee(db, v) {
  const result = db
    .prepare('INSERT INTO employees (name, department, is_staff, is_active) VALUES (?, ?, ?, 1)')
    .run(v.name, v.department, v.isStaff ? 1 : 0);
  return Number(result.lastInsertRowid);
}

export function updateEmployee(db, id, v) {
  db.prepare('UPDATE employees SET name = ?, department = ?, is_staff = ?, is_active = ? WHERE id = ?')
    .run(v.name, v.department, v.isStaff ? 1 : 0, v.isActive ? 1 : 0, id);
}

/** 有効な「担当者」区分の社員の人数。 */
export function countActiveStaff(db) {
  return db.prepare('SELECT count(*) AS n FROM employees WHERE is_staff = 1 AND is_active = 1').get().n;
}

/** 未完了(未対応・対応中・保留)の問い合わせの担当者になっている件数。 */
export function countOpenAssigned(db, employeeId) {
  return db
    .prepare("SELECT count(*) AS n FROM inquiries WHERE assignee_id = ? AND status <> '完了'")
    .get(employeeId).n;
}

/** @param {{active?: boolean}} f */
export function listCategories(db, f = {}) {
  const where = [];
  const params = [];
  if (f.active !== undefined) { where.push('is_active = ?'); params.push(f.active ? 1 : 0); }
  const sql = `SELECT id, name, sort_order, is_active FROM categories
               ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY sort_order, id`;
  return db.prepare(sql).all(...params).map(toCategory);
}

export function getCategory(db, id) {
  const r = db.prepare('SELECT id, name, sort_order, is_active FROM categories WHERE id = ?').get(id);
  return r ? toCategory(r) : null;
}

/** 同じ名称のカテゴリがあるか(無効なものを含む)。excludeId は自分自身を除く。 */
export function categoryNameExists(db, name, excludeId = null) {
  const r = db
    .prepare('SELECT 1 AS found FROM categories WHERE name = ? AND id <> ?')
    .get(name, excludeId ?? -1);
  return Boolean(r);
}

export function insertCategory(db, v) {
  const result = db
    .prepare('INSERT INTO categories (name, sort_order, is_active) VALUES (?, ?, 1)')
    .run(v.name, v.sortOrder);
  return Number(result.lastInsertRowid);
}

export function updateCategory(db, id, v) {
  db.prepare('UPDATE categories SET name = ?, sort_order = ?, is_active = ? WHERE id = ?')
    .run(v.name, v.sortOrder, v.isActive ? 1 : 0, id);
}
