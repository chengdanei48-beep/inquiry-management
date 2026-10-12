// 問い合わせのDBアクセス。SQLの値はすべてプレースホルダ(?)で渡す。
export const PAGE_SIZE = 20;

const BASE_SELECT = `
  SELECT i.id, i.title, i.body, i.priority, i.status, i.resolution,
         i.received_at, i.updated_at, i.completed_at, i.work_minutes,
         i.category_id, c.name AS category_name,
         i.requester_id, r.name AS requester_name, r.department AS requester_dept,
         i.assignee_id, a.name AS assignee_name,
         i.related_inquiry_id, rel.title AS related_title
    FROM inquiries i
    JOIN categories c ON c.id = i.category_id
    JOIN employees r ON r.id = i.requester_id
    LEFT JOIN employees a ON a.id = i.assignee_id
    LEFT JOIN inquiries rel ON rel.id = i.related_inquiry_id`;

/** LIKE のワイルドカード(% _)とエスケープ文字を、文字として扱えるようにする。 */
export function escapeLike(text) {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * 一覧の絞り込み・並び順を組み立てる(一覧API と CSV出力で共通)。
 * @param {object} f parseInquiryListQuery の結果
 * @returns {{ where: string, orderBy: string, params: any[] }}
 */
export function buildListQuery(f) {
  const conditions = [];
  const params = [];
  if (f.status) { conditions.push('i.status = ?'); params.push(f.status); }
  if (f.categoryId) { conditions.push('i.category_id = ?'); params.push(f.categoryId); }
  if (f.assigneeId === 'none') conditions.push('i.assignee_id IS NULL');
  else if (f.assigneeId) { conditions.push('i.assignee_id = ?'); params.push(f.assigneeId); }
  if (f.dept) { conditions.push('r.department = ?'); params.push(f.dept); }
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    conditions.push("(i.title LIKE ? ESCAPE '\\' OR i.body LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  // 並び順は「指定した項目 → 受付日時(新しい順) → ID(新しい順)」。同じ時刻でも順序が変わらない。
  const orderBy = f.sort === 'priority'
    ? `CASE i.priority WHEN '高' THEN 1 WHEN '中' THEN 2 ELSE 3 END ${dir === 'ASC' ? 'ASC' : 'DESC'}, i.received_at DESC, i.id DESC`
    : `i.received_at ${dir}, i.id ${dir}`;
  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    orderBy,
    params,
  };
}

export function toSummary(row) {
  return {
    id: row.id,
    title: row.title,
    category: { id: row.category_id, name: row.category_name },
    requester: { id: row.requester_id, name: row.requester_name, dept: row.requester_dept },
    priority: row.priority,
    status: row.status,
    assignee: row.assignee_id === null ? null : { id: row.assignee_id, name: row.assignee_name },
    receivedAt: row.received_at,
  };
}

function toHistory(row) {
  return {
    id: row.id,
    type: row.type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    content: row.content,
    operator: { id: row.operator_id, name: row.operator_name },
    at: row.at,
  };
}

/** 一覧(ページング)。 */
export function listInquiries(db, filters) {
  const { where, orderBy, params } = buildListQuery(filters);
  const total = db
    .prepare(`SELECT count(*) AS n FROM inquiries i JOIN employees r ON r.id = i.requester_id ${where}`)
    .get(...params).n;
  const offset = (filters.page - 1) * PAGE_SIZE;
  const rows = db
    .prepare(`${BASE_SELECT} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, offset);
  return { items: rows.map(toSummary), total, page: filters.page, pageSize: PAGE_SIZE };
}

/** 条件に合う全件(CSV出力用。ページングしない)。 */
export function listAllInquiries(db, filters) {
  const { where, orderBy, params } = buildListQuery(filters);
  return db.prepare(`${BASE_SELECT} ${where} ORDER BY ${orderBy}`).all(...params).map((row) => ({
    ...toSummary(row),
    body: row.body,
    resolution: row.resolution,
    completedAt: row.completed_at,
    workMinutes: row.work_minutes,
    updatedAt: row.updated_at,
  }));
}

/** 更新・判定に使う行(存在しなければ undefined)。 */
export function findInquiry(db, id) {
  return db.prepare('SELECT * FROM inquiries WHERE id = ?').get(id);
}

export function getHistories(db, inquiryId) {
  return db
    .prepare(`SELECT h.id, h.type, h.from_status, h.to_status, h.content, h.operator_id,
                     e.name AS operator_name, h.at
                FROM inquiry_histories h
                JOIN employees e ON e.id = h.operator_id
               WHERE h.inquiry_id = ?
               ORDER BY h.at, h.id`)
    .all(inquiryId)
    .map(toHistory);
}

/** 詳細(履歴つき)。存在しなければ null。 */
export function getDetail(db, id) {
  const row = db.prepare(`${BASE_SELECT} WHERE i.id = ?`).get(id);
  if (!row) return null;
  return {
    ...toSummary(row),
    body: row.body,
    resolution: row.resolution,
    completedAt: row.completed_at,
    workMinutes: row.work_minutes,
    relatedInquiry: row.related_inquiry_id === null ? null : { id: row.related_inquiry_id, title: row.related_title },
    updatedAt: row.updated_at,
    histories: getHistories(db, id),
  };
}

export function insertInquiry(db, v) {
  const result = db
    .prepare(`INSERT INTO inquiries
                (title, body, requester_id, category_id, priority, status, related_inquiry_id, received_at, updated_at)
              VALUES (?, ?, ?, ?, ?, '未対応', ?, ?, ?)`)
    .run(v.title, v.body, v.requesterId, v.categoryId, v.priority, v.relatedInquiryId, v.now, v.now);
  return Number(result.lastInsertRowid);
}

export function insertHistory(db, h) {
  db.prepare(`INSERT INTO inquiry_histories (inquiry_id, type, from_status, to_status, content, operator_id, at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(h.inquiryId, h.type, h.fromStatus ?? null, h.toStatus ?? null, h.content ?? null, h.operatorId, h.at);
}

/**
 * 更新日時が一致するときだけ更新する(楽観ロック)。更新できたら true。
 * @param {object} changes 列名 → 値(updated_at を含めること)
 */
export function updateInquiryIfUnchanged(db, id, expectedUpdatedAt, changes) {
  const columns = Object.keys(changes);
  const sql = `UPDATE inquiries SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND updated_at = ?`;
  const result = db.prepare(sql).run(...columns.map((c) => changes[c]), id, expectedUpdatedAt);
  return result.changes === 1;
}

export function findEmployee(db, id) {
  return db.prepare('SELECT id, name, department, is_staff, is_active FROM employees WHERE id = ?').get(id);
}

export function findCategory(db, id) {
  return db.prepare('SELECT id, name, is_active FROM categories WHERE id = ?').get(id);
}
