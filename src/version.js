// アプリの名前とバージョン。バージョンは package.json の `version` が正(CHANGELOG.md と一致させる)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_NAME = '問い合わせ管理';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** package.json の version(例: '1.0.0')。 */
export function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}
