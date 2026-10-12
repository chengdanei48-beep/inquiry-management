// 初期データ(docs/requirements.md F-09)。

/** カテゴリの初期値(表示順は先頭から 1, 2, …)。 */
export const INITIAL_CATEGORIES = [
  'PC・ネットワーク',
  'アカウント・権限',
  '備品・ソフト申請',
  '入退社手続き',
  'その他',
];

/**
 * カテゴリが1件も無いときだけ、初期値を作成する。
 * @returns {number} 作成した件数(既にカテゴリがあれば 0)
 */
export function ensureInitialCategories(db) {
  const { n } = db.prepare('SELECT count(*) AS n FROM categories').get();
  if (n > 0) return 0;
  const insert = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
  INITIAL_CATEGORIES.forEach((name, i) => insert.run(name, i + 1));
  return INITIAL_CATEGORIES.length;
}
