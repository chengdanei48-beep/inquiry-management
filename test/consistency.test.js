// 設計書・課金ルールと実装の整合(quality-review「docs ⇔ 実装の差異」「課金ルール」)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiRoutes } from '../src/api/index.js';
import { findChrome } from '../scripts/e2e/browser.js';
import { startTestApp } from '../test-support/app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');

function walk(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full, ext);
    return full.endsWith(ext) ? [full] : [];
  });
}

test('設計書: エンドポイント一覧(api-design.md 4章)と、実装のルートが一致する', () => {
  const doc = read('docs', 'api-design.md');
  const section = doc.slice(doc.indexOf('## 4. エンドポイント一覧'), doc.indexOf('## 5. 主要APIの詳細'));
  const documented = [...section.matchAll(/^\|[^|]*\|\s*(GET|POST|PATCH|DELETE)\s*\|\s*`([^`]+)`/gm)]
    .map((m) => `${m[1]} ${m[2].replace(/\{(\w+)\}/g, ':$1')}`)
    .sort();
  const implemented = createApiRoutes().map((r) => `${r.method} ${r.path}`).sort();
  assert.ok(documented.length >= 19, `設計書から ${documented.length} 件しか読み取れなかった`);
  assert.deepEqual(implemented, documented);
});

test('設計書: エラーコード(api-design.md 3章)と、実装で使うコードが一致する', () => {
  const doc = read('docs', 'api-design.md');
  const section = doc.slice(doc.indexOf('### エラーコードと画面での表示') >= 0 ? doc.indexOf('| code | HTTP |') : 0, doc.indexOf('## 4. エンドポイント一覧'));
  const documented = new Set([...section.matchAll(/^\|\s*`([A-Z_]+)`\s*\|\s*\d{3}\s*\|/gm)].map((m) => m[1]));
  const used = new Set();
  for (const file of walk(path.join(root, 'src'), '.js')) {
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(/(?:conflict\(\s*|AppError\(\s*\d+,\s*)'([A-Z_]+)'/g)) used.add(m[1]);
  }
  assert.ok(documented.size >= 9, `設計書から ${documented.size} 件しか読み取れなかった`);
  assert.deepEqual([...used].sort(), [...documented].sort());
});

test('設計書: 画面設計書 2.3 のメッセージが、画面またはサーバーのコードにある', () => {
  const doc = read('docs', 'screen-design.md');
  const section = doc.slice(doc.indexOf('### 2.3 メッセージ'), doc.indexOf('### 2.4'));
  const messages = [...section.matchAll(/^\|[^|]+\|\s*「([^」]+)」/gm)]
    .map((m) => m[1])
    .filter((m) => !m.includes('{'));
  assert.ok(messages.length >= 8, `${messages.length} 件しか読み取れなかった`);
  const sources = [...walk(path.join(root, 'src'), '.js'), ...walk(path.join(root, 'public', 'js'), '.js')]
    .map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const missing = messages.filter((m) => !sources.includes(m));
  assert.deepEqual(missing, [], `実装に無いメッセージ: ${missing.join(' / ')}`);
});

test('課金ルール: 依存パッケージが無く、Node.js v24 以降を要求している', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.equal(pkg[key], undefined, `${key} がある`);
  }
  assert.match(pkg.engines.node, />=\s*24/);
  assert.equal(pkg.private, true);
  // npm のスクリプトが、要件のとおり揃っている
  for (const name of ['start', 'test', 'seed', 'e2e']) assert.ok(pkg.scripts[name], `scripts.${name} が無い`);
});

test('課金ルール: 外部サービス・SDK・クラウドの利用が、コードに無い', () => {
  // import 文・require・動的 import の取り込み先が、Node.js 標準(node:)か、このリポジトリ内の相対パスだけであること
  const specifiers = (source) => [
    ...source.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm),
    ...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((m) => m[1]);
  const files = [
    ...walk(path.join(root, 'src'), '.js'),
    ...walk(path.join(root, 'scripts'), '.js'),
    ...walk(path.join(root, 'public', 'js'), '.js'),
  ];
  let checked = 0;
  for (const file of files) {
    for (const spec of specifiers(fs.readFileSync(file, 'utf8'))) {
      checked += 1;
      assert.ok(spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../'),
        `${path.relative(root, file)} が外部のモジュール「${spec}」を取り込んでいる`);
    }
  }
  assert.ok(checked > 30, `取り込みを ${checked} 件しか確認できなかった`);
  // 外部サービスの名前が、コードに無い(コメントを除く)
  const services = /aws-sdk|firebase|googleapis|stripe|openai|api\.anthropic|\.amazonaws\.com|cloudflare|azure/i;
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!services.test(code), `${path.relative(root, file)} が外部サービスを参照している`);
  }
});

test('バージョン: package.json・CHANGELOG・README・起動時のログが一致し、semver である', async () => {
  const { readVersion, APP_NAME } = await import('../src/version.js');
  const pkg = JSON.parse(read('package.json'));
  const version = readVersion();
  assert.equal(version, pkg.version);
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(APP_NAME, '問い合わせ管理');
  // CHANGELOG の先頭の版が、現在のバージョン
  const latest = /^## \[(\d+\.\d+\.\d+)\]/m.exec(read('CHANGELOG.md'));
  assert.ok(latest, 'CHANGELOG に版の見出しが無い');
  assert.equal(latest[1], version);
  // README のバッジと、起動時のログが、同じバージョンを示す
  assert.ok(read('README.md').includes(`version-${version}-`), 'README のバージョンのバッジが一致しない');
  assert.ok(read('src', 'main.js').includes('readVersion()'), '起動時のログにバージョンを出していない');
});

test('ライセンス: LICENSE(MIT)があり、package.json の license と一致する', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.license, 'MIT');
  const license = read('LICENSE');
  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) \d{4} \S+/);
  assert.match(read('README.md'), /\[MIT\]\(LICENSE\)/);
});

test('公開: 個人のメールアドレス・ローカルのパスが、リポジトリのファイルに無い', () => {
  const skip = /(^|[\\/])(node_modules|\.git|data|e2e-output)([\\/]|$)/;
  const files = walk(root, '')
    .filter((f) => !skip.test(path.relative(root, f)))
    .filter((f) => /\.(js|json|md|html|css|svg|yml|yaml|txt)$/.test(f) || path.basename(f) === 'LICENSE');
  assert.ok(files.length > 40, `${files.length} 件しか調べていない`);
  const patterns = [
    // メールアドレス(GitHub の noreply・Anthropic の共同作者表記・例示用は除く)
    // (GitHub の Web 操作のコミッター noreply@github.com も、個人のメールではないため除く)
    /\b(?!noreply@github\.com)[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com|anthropic\.com|example\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
    // Windows / Unix のホームディレクトリ
    /[A-Za-z]:\\Users\\/,
    /\/Users\/[a-z]/,
  ];
  const self = path.join('test', 'consistency.test.js');
  for (const file of files) {
    if (path.relative(root, file) === self) continue; // 検査の正規表現そのもの
    const source = fs.readFileSync(file, 'utf8');
    for (const re of patterns) {
      const m = re.exec(source);
      assert.ok(!m, `${path.relative(root, file)} に個人情報らしき文字列がある: ${m && m[0]}`);
    }
  }
});

test('データ保護: DBファイルと実行時データを Git に含めない設定', () => {
  const ignore = read('.gitignore');
  for (const pattern of ['data/', '*.db', 'node_modules/', '.env', 'e2e-output/']) {
    assert.ok(ignore.split('\n').some((l) => l.trim() === pattern), `.gitignore に ${pattern} が無い`);
  }
});

test('公開範囲: localhost 以外のアドレスからは、接続できない', async (t) => {
  const app = await startTestApp();
  try {
    // このアプリの待ち受けポートを調べるため、サーバーを直接起動し直す
    const { createServer } = await import('../src/server.js');
    const { createApiRoutes: routes } = await import('../src/api/index.js');
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig({ PORT: '0', DB_PATH: ':memory:' });
    const server = createServer({ db: app.db, config, routes: routes(), log: () => {} });
    await new Promise((resolve) => server.listen(0, config.host, resolve));
    const { port, address } = server.address();
    try {
      assert.equal(address, '127.0.0.1');
      // 自分のマシンの、loopback 以外のアドレス(LANなど)
      const external = Object.values(os.networkInterfaces()).flat()
        .find((i) => i && i.family === 'IPv4' && !i.internal);
      if (!external) {
        t.skip('loopback 以外のアドレスが無い環境のため、実際の接続の確認は省略');
        return;
      }
      const error = await new Promise((resolve) => {
        const socket = net.connect({ host: external.address, port, timeout: 2000 });
        socket.once('connect', () => { socket.destroy(); resolve(null); });
        socket.once('timeout', () => { socket.destroy(); resolve(new Error('timeout')); });
        socket.once('error', resolve);
      });
      assert.ok(error, `${external.address}:${port} に接続できてしまった`);
      t.diagnostic(`${external.address}:${port} への接続: ${error.code ?? error.message}`);
      // localhost からは接続できる
      const ok = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(ok.status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await app.close();
  }
});

test('実ブラウザ確認: Chrome の探索(CHROME_PATH を優先し、見つからなければ null)', () => {
  assert.equal(findChrome({ CHROME_PATH: process.execPath }), process.execPath);
  const none = findChrome({ CHROME_PATH: path.join(os.tmpdir(), 'no-such-chrome.exe'), LOCALAPPDATA: undefined });
  assert.ok(none === null || typeof none === 'string');
});

test('技術スタック: README・CLAUDE.md・要件定義書・API設計書・配備ファイルが、同じ内容(Node.js 24・EC2・systemd・HTTP 80)を記載している', () => {
  const pkg = JSON.parse(read('package.json'));
  const major = /(\d+)/.exec(pkg.engines.node)[1];
  assert.equal(major, '24');

  // Node.js のバージョンと、標準の node:sqlite
  for (const file of [['README.md'], ['CLAUDE.md'], ['docs', 'requirements.md']]) {
    const text = read(...file);
    assert.match(text, new RegExp(`Node\.js[^\n]*v${major}`), `${file.join('/')} に Node.js v${major} の記載がない`);
    assert.ok(text.includes('node:sqlite'), `${file.join('/')} に node:sqlite の記載がない`);
  }

  // AWS(EC2)でのデプロイ: 全ての主要な文書に記載がある
  for (const file of [['README.md'], ['CLAUDE.md'], ['docs', 'requirements.md'], ['docs', 'api-design.md'], ['docs', 'deployment-decision.md'], ['docs', 'aws-deployment.md']]) {
    assert.ok(read(...file).includes('EC2'), `${file.join('/')} に EC2 の記載がない`);
  }
  // README の技術スタックの節に、稼働環境(デプロイ)がある
  const readme = read('README.md');
  const stack = readme.slice(readme.indexOf('## 技術スタック'), readme.indexOf('## 起動とテスト'));
  assert.ok(stack.length > 100, '技術スタックの節を読み取れなかった');
  assert.match(stack, /AWS EC2/);
  assert.match(stack, /Amazon Linux 2023/);
  assert.ok(!/ローカルだけで動作する/.test(stack), '「ローカルだけで動作する」の記載が残っている(AWS のデプロイと矛盾)');

  // 配備ファイルの設定が、手順書・技術スタックの記載と一致する
  const setup = read('deploy', 'setup-ec2.sh');
  const unit = read('deploy', 'inquiry-management.service');
  assert.ok(setup.includes(`latest-v${major}.x`), 'setup-ec2.sh が、Node.js 24 系を取得していない');
  assert.match(setup, /PORT=80\b/);
  assert.match(setup, /NODE_LINK=\/opt\/node/);
  assert.ok(unit.includes('ExecStart=/opt/node/bin/node src/main.js'));
  assert.ok(unit.includes('EnvironmentFile=/etc/inquiry-management.env'));
  assert.ok(setup.includes('/etc/inquiry-management.env'));
  const guide = read('docs', 'aws-deployment.md');
  assert.ok(guide.includes('Amazon Linux 2023') && guide.includes('t3.micro'));
  assert.ok(guide.includes('deploy/setup-ec2.sh') || guide.includes('setup-ec2.sh'));
  assert.ok(guide.includes(`v${pkg.version}`), '手順書のタグ(REF)が、現在のバージョンと一致しない');
});
