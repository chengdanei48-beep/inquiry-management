import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { ensureInitialCategories } from './db/initial.js';
import { createServer } from './server.js';
import { APP_NAME, readVersion } from './version.js';
import { createApiRoutes } from './api/index.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  // 設定の誤り(例: 認証なしで外部に公開しようとした)は、スタックトレースを出さず、理由だけを表示する
  console.error(`設定が正しくありません: ${err.message}`);
  process.exit(1);
}
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
  const authNote = config.auth ? `認証あり(ユーザー: ${config.auth.user})` : '認証なし(localhost のみ)';
  console.log(`起動しました: ${APP_NAME} v${readVersion()} http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${server.address().port}/ ${authNote} (DB: ${config.dbPath})`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
