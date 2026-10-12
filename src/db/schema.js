// DB定義(docs/api-design.md 7章)。スキーマの版は PRAGMA user_version で持つ。
export const SCHEMA_VERSION = 1;

// 'YYYY-MM-DD HH:mm:ss.SSS' の形(日本時間のローカル時刻)
const DATETIME_GLOB = "'[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9] [0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]'";

const STATUSES = "('未対応', '対応中', '保留', '完了')";

const SCHEMA_SQL = `
CREATE TABLE employees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 50),
  department  TEXT    NOT NULL CHECK (length(trim(department)) BETWEEN 1 AND 50),
  is_staff    INTEGER NOT NULL DEFAULT 0 CHECK (is_staff IN (0, 1)),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 50),
  sort_order  INTEGER NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE inquiries (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  title               TEXT    NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 50),
  body                TEXT    NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 50),
  requester_id        INTEGER NOT NULL REFERENCES employees(id),
  category_id         INTEGER NOT NULL REFERENCES categories(id),
  priority            TEXT    NOT NULL CHECK (priority IN ('高', '中', '低')),
  status              TEXT    NOT NULL CHECK (status IN ${STATUSES}),
  assignee_id         INTEGER REFERENCES employees(id),
  related_inquiry_id  INTEGER REFERENCES inquiries(id),
  resolution          TEXT    CHECK (resolution IS NULL OR length(trim(resolution)) BETWEEN 1 AND 50),
  received_at         TEXT    NOT NULL CHECK (received_at GLOB ${DATETIME_GLOB}),
  updated_at          TEXT    NOT NULL CHECK (updated_at GLOB ${DATETIME_GLOB}),
  completed_at        TEXT    CHECK (completed_at IS NULL OR completed_at GLOB ${DATETIME_GLOB}),
  work_minutes        INTEGER CHECK (work_minutes IS NULL OR work_minutes >= 0),
  -- 担当者は、ステータスが「未対応」以外では必須
  CHECK (status = '未対応' OR assignee_id IS NOT NULL),
  -- 完了と、完了関連の列(対応内容・完了日時・対応時間)は一対一に対応する
  CHECK ((status = '完了') = (completed_at IS NOT NULL AND resolution IS NOT NULL AND work_minutes IS NOT NULL)),
  CHECK (status = '完了' OR (completed_at IS NULL AND resolution IS NULL AND work_minutes IS NULL)),
  -- 関連する問い合わせは自分自身を指せない
  CHECK (related_inquiry_id IS NULL OR related_inquiry_id <> id)
);

CREATE TABLE inquiry_histories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id   INTEGER NOT NULL REFERENCES inquiries(id),
  type         TEXT    NOT NULL CHECK (type IN ('registered', 'status', 'assignee', 'comment', 'edit')),
  from_status  TEXT    CHECK (from_status IS NULL OR from_status IN ${STATUSES}),
  to_status    TEXT    CHECK (to_status IS NULL OR to_status IN ${STATUSES}),
  content      TEXT,
  operator_id  INTEGER NOT NULL REFERENCES employees(id),
  at           TEXT    NOT NULL CHECK (at GLOB ${DATETIME_GLOB}),
  -- ステータス変更は変更前後のステータスが必須
  CHECK (type <> 'status' OR (from_status IS NOT NULL AND to_status IS NOT NULL)),
  -- コメントは内容が必須(1〜50文字)
  CHECK (type <> 'comment' OR (content IS NOT NULL AND length(trim(content)) BETWEEN 1 AND 50))
);

CREATE INDEX idx_inquiries_status       ON inquiries (status);
CREATE INDEX idx_inquiries_received     ON inquiries (received_at, id);
CREATE INDEX idx_inquiries_assignee     ON inquiries (assignee_id, status);
CREATE INDEX idx_inquiries_category     ON inquiries (category_id);
CREATE INDEX idx_histories_inquiry_at   ON inquiry_histories (inquiry_id, at);
`;

/**
 * スキーマを作成する。版が 0(未作成)のときだけ作成し、
 * 現在の版より新しいDBは拒否する(古いコードで新しいDBを壊さないため)。
 */
export function migrate(db) {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  if (version > SCHEMA_VERSION) {
    throw new Error(`DBのスキーマの版(${version})が、このアプリの版(${SCHEMA_VERSION})より新しいです`);
  }
  if (version === SCHEMA_VERSION) return;

  db.exec('BEGIN');
  try {
    db.exec(SCHEMA_SQL);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
