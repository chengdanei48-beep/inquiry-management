/**
 * fn を1つのトランザクションで実行する。例外が起きたらすべて取り消す。
 * BEGIN IMMEDIATE で書き込みの権利を先に取り、途中での競合を避ける。
 */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
