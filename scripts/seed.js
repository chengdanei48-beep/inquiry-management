// サンプルデータを投入する(npm run seed)。
// 社員・問い合わせが既にあるDBには、何もしない。
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { seedDatabase } from '../src/seed.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
try {
  const result = seedDatabase(db);
  if (result.seeded) {
    console.log(`サンプルデータを投入しました: 社員${result.employees}名、問い合わせ${result.inquiries}件(DB: ${config.dbPath})`);
  } else {
    console.log(`既にデータがあるため、何もしませんでした(DB: ${config.dbPath})`);
  }
} finally {
  db.close();
}
