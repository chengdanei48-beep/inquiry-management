import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { ensureInitialCategories } from './db/initial.js';
import { createServer } from './server.js';
import { createApiRoutes } from './api/index.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
ensureInitialCategories(db); // カテゴリの初期値(F-09)。カテゴリが空のときだけ作成する
const server = createServer({ db, config, routes: createApiRoutes() });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`ポート ${config.port} は使用中です。使用しているプロセスを停止してから、もう一度起動してください。`);
  } else {
    console.error(`サーバーを起動できません: ${err.message}`);
  }
  db.close();
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  console.log(`起動しました: http://localhost:${server.address().port}/ (DB: ${config.dbPath})`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
