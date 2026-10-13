// scripts/publish.js(公開版の更新)の統合テスト。一時ディレクトリの git リポジトリだけを使う
// (GitHub・gh には接続しない。公開リポジトリの代わりに、bare リポジトリを使う)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isNoreply, parseArgs, publish, PublishError, resolveIdentity } from '../scripts/publish.js';

const IDENTITY = { name: 'pub-user', email: '123+pub-user@users.noreply.github.com' };
const PERSON = { name: 'Dev Person', email: 'dev@example.com' }; // 個人情報(テスト用)

function git(cwd, args, env = {}) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
  }).trim();
}

const asPerson = (p = PERSON) => ({
  GIT_AUTHOR_NAME: p.name, GIT_AUTHOR_EMAIL: p.email, GIT_COMMITTER_NAME: p.name, GIT_COMMITTER_EMAIL: p.email,
});

/** 開発用リポジトリ(個人名義のコミットが2つ)と、空の公開リポジトリ(bare)を作る。 */
function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-test-'));
  const dev = path.join(base, 'dev');
  const pub = path.join(base, 'public.git');
  fs.mkdirSync(dev);
  git(dev, ['init', '-q', '-b', 'master']);
  fs.writeFileSync(path.join(dev, 'package.json'), JSON.stringify({ name: 'demo-app', version: '1.0.0' }));
  fs.writeFileSync(path.join(dev, 'README.md'), '# demo\n');
  git(dev, ['add', '-A']);
  git(dev, ['commit', '-q', '-m', 'first'], asPerson());
  fs.writeFileSync(path.join(dev, 'a.txt'), 'a\n');
  git(dev, ['add', '-A']);
  git(dev, ['commit', '-q', '-m', 'second'], asPerson());
  git(base, ['init', '-q', '--bare', '-b', 'master', pub]);
  const commit = (file, content, message, person = PERSON) => {
    fs.writeFileSync(path.join(dev, file), content);
    git(dev, ['add', '-A']);
    git(dev, ['commit', '-q', '-m', message], asPerson(person));
  };
  const run = (opts = {}) => publish({ repoDir: dev, publicUrl: pub, identity: IDENTITY, skipTests: true, ...opts });
  return { base, dev, pub, commit, run, cleanup: () => fs.rmSync(base, { recursive: true, force: true, maxRetries: 3 }) };
}

const logOf = (dir, ref = 'master') => git(dir, ['log', ref, '--format=%H|%an|%ae|%cn|%ce|%s']).split('\n').map((l) => l.split('|'));

test('置き換え: 試し実行では、何も反映しない', () => {
  const s = setup();
  try {
    const result = s.run({ push: false });
    assert.deepEqual([result.action, result.newCommits, result.pushed], ['create', 2, false]);
    assert.equal(git(s.pub, ['for-each-ref']), ''); // 公開側は空のまま
  } finally { s.cleanup(); }
});

test('置き換え: 初回の反映で、履歴は残り、作者・コミッターは公開用の名前・noreply になる', () => {
  const s = setup();
  try {
    const result = s.run({ push: true });
    assert.deepEqual([result.action, result.newCommits, result.pushed], ['create', 2, true]);
    const published = logOf(s.pub);
    assert.equal(published.length, 2);
    assert.deepEqual(published.map((l) => l[5]), ['second', 'first']); // メッセージは変わらない
    for (const [, an, ae, cn, ce] of published) {
      assert.deepEqual([an, ae, cn, ce], [IDENTITY.name, IDENTITY.email, IDENTITY.name, IDENTITY.email]);
    }
    // 個人情報が、公開側のどこにも無い(履歴のメタデータ)
    assert.ok(!git(s.pub, ['log', '--all', '--format=%an %ae %cn %ce %B']).includes('dev@example.com'));
    assert.ok(!git(s.pub, ['log', '--all', '--format=%an %ae %cn %ce %B']).includes('Dev Person'));
    // 内容は、開発用と同一
    assert.equal(git(s.pub, ['rev-parse', 'master^{tree}']), git(s.dev, ['rev-parse', 'master^{tree}']));
    // 開発用の履歴は、書き換えられていない
    assert.equal(logOf(s.dev)[0][2], PERSON.email);
  } finally { s.cleanup(); }
});

test('置き換え: 変更が無ければ「一致」で、何も反映しない。コミットを追加すると、通常の push(fast-forward)になる', () => {
  const s = setup();
  try {
    s.run({ push: true });
    const before = logOf(s.pub).map((l) => l[0]);

    const same = s.run({ push: true });
    assert.deepEqual([same.action, same.newCommits, same.pushed], ['up-to-date', 0, false]);

    s.commit('b.txt', 'b\n', 'third');
    s.commit('c.txt', 'c\n', 'fourth');
    const ff = s.run({ push: true });
    assert.deepEqual([ff.action, ff.newCommits, ff.pushed], ['fast-forward', 2, true]);
    const after = logOf(s.pub);
    assert.equal(after.length, 4);
    // 既存のコミットの ID は変わらない(置き換えが決定的なため、公開側の履歴は、そのまま延びる)
    assert.deepEqual(after.slice(2).map((l) => l[0]), before);
    assert.ok(after.every((l) => l[2] === IDENTITY.email));
  } finally { s.cleanup(); }
});

test('置き換え: GitHub の noreply(Web UI のマージ)のコミッターは、そのまま残す', () => {
  const s = setup();
  try {
    s.commit('m.txt', 'm\n', 'merge via web', PERSON);
    // コミッターを GitHub にしたコミット(GitHub の Web UI でのマージを模擬)
    fs.writeFileSync(path.join(s.dev, 'w.txt'), 'w\n');
    git(s.dev, ['add', '-A']);
    git(s.dev, ['commit', '-q', '-m', 'web merge'], {
      ...asPerson(), GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@github.com',
    });
    s.run({ push: true });
    const [top] = logOf(s.pub);
    assert.deepEqual(top.slice(1, 5), [IDENTITY.name, IDENTITY.email, 'GitHub', 'noreply@github.com']);
  } finally { s.cleanup(); }
});

test('食い違い: 公開側に別のコミットがあると、反映せずに中止する。--force なら上書きする', () => {
  const s = setup();
  try {
    s.run({ push: true });
    // 公開側に、別の履歴を直接積む
    const other = path.join(s.base, 'other');
    git(s.base, ['clone', '-q', s.pub, other]);
    fs.writeFileSync(path.join(other, 'x.txt'), 'x\n');
    git(other, ['add', '-A']);
    git(other, ['commit', '-q', '-m', 'direct edit'], asPerson({ name: IDENTITY.name, email: IDENTITY.email }));
    git(other, ['push', '-q', 'origin', 'master']);
    const divergedTip = git(s.pub, ['rev-parse', 'master']);

    s.commit('d.txt', 'd\n', 'dev change');
    // 公開側のコミットが、書き換え後の履歴に無い → 食い違い
    assert.throws(() => s.run({ push: true }), (e) => e instanceof PublishError && /食い違っている/.test(e.message));
    assert.equal(git(s.pub, ['rev-parse', 'master']), divergedTip); // 変わっていない

    // --force を付けると、公開側を、書き換え後の履歴で上書きする(公開側にだけあったコミットは消える)
    const forced = s.run({ push: true, force: true });
    assert.deepEqual([forced.action, forced.pushed], ['diverged', true]);
    assert.notEqual(git(s.pub, ['rev-parse', 'master']), divergedTip);
    const published = logOf(s.pub);
    assert.deepEqual(published.map((l) => l[5]), ['dev change', 'second', 'first']);
    assert.ok(!published.some((l) => l[5] === 'direct edit'));
  } finally { s.cleanup(); }
});

test('事前確認: 未コミットの変更・別のブランチ・origin と不一致のときは、中止する', () => {
  const s = setup();
  try {
    fs.writeFileSync(path.join(s.dev, 'dirty.txt'), 'dirty\n');
    assert.throws(() => s.run({ push: true }), (e) => /未コミットの変更/.test(e.message));
    fs.rmSync(path.join(s.dev, 'dirty.txt'));

    git(s.dev, ['switch', '-q', '-c', 'topic']);
    assert.throws(() => s.run({ push: true }), (e) => /現在のブランチは topic/.test(e.message));
    git(s.dev, ['switch', '-q', 'master']);

    // origin(開発用のサーバー)より進んでいる状態
    const origin = path.join(s.base, 'origin.git');
    git(s.base, ['init', '-q', '--bare', '-b', 'master', origin]);
    git(s.dev, ['remote', 'add', 'origin', origin]);
    git(s.dev, ['push', '-q', 'origin', 'master']);
    s.commit('e.txt', 'e\n', 'not pushed yet');
    assert.throws(() => s.run({ push: true }), (e) => /origin\/master と一致しません/.test(e.message));
    assert.equal(git(s.pub, ['for-each-ref']), '');
  } finally { s.cleanup(); }
});

test('安全: ファイルの内容に個人情報(メール・名前)があると、公開しない', () => {
  for (const [label, content] of [['メール', 'contact: dev@example.com\n'], ['名前', 'Author: Dev Person\n']]) {
    const s = setup();
    try {
      s.commit('notes.md', content, `add notes (${label})`);
      assert.throws(() => s.run({ push: true }), (e) => e instanceof PublishError && /個人情報/.test(e.message), label);
      assert.equal(git(s.pub, ['for-each-ref']), '', `${label}: 公開側に何も反映されていない`);
    } finally { s.cleanup(); }
  }
});

test('安全: 過去のコミットだけに個人情報がある場合も、公開しない(全リビジョンを検査する)', () => {
  const s = setup();
  try {
    s.commit('secret.txt', 'dev@example.com\n', 'add secret');
    s.commit('secret.txt', 'removed\n', 'remove secret'); // 最新の内容には無いが、履歴には残る
    assert.throws(() => s.run({ push: true }), (e) => /個人情報/.test(e.message));
    assert.equal(git(s.pub, ['for-each-ref']), '');
  } finally { s.cleanup(); }
});

test('タグ: 新しいタグを反映し、公開側で別のコミットを指すタグは、--force なしでは中止する', () => {
  const s = setup();
  try {
    git(s.dev, ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0'], asPerson());
    const first = s.run({ push: true });
    assert.deepEqual(first.tags, ['v1.0.0']);
    const pubTag = git(s.pub, ['rev-parse', 'v1.0.0^{commit}']);
    assert.equal(pubTag, git(s.pub, ['rev-parse', 'master'])); // タグは、書き換え後の対応するコミット

    assert.deepEqual(s.run({ push: true }).tags, []); // 2回目: 一致

    // 公開側のタグを、別のコミットへ動かす
    const other = path.join(s.base, 'other');
    git(s.base, ['clone', '-q', s.pub, other]);
    git(other, ['tag', '-f', 'v1.0.0', 'HEAD~1']);
    git(other, ['push', '-q', '--force', 'origin', 'v1.0.0']);
    assert.throws(() => s.run({ push: true }), (e) => /タグと食い違っています/.test(e.message));
    const forced = s.run({ push: true, force: true });
    assert.deepEqual(forced.tags, ['v1.0.0']);
    assert.equal(git(s.pub, ['rev-parse', 'v1.0.0^{commit}']), git(s.pub, ['rev-parse', 'master']));
  } finally { s.cleanup(); }
});

test('公開する作者: noreply 以外のメールは拒否し、既定は GitHub のアカウント情報から作る', () => {
  assert.throws(() => resolveIdentity({ PUBLISH_NAME: 'x', PUBLISH_EMAIL: 'dev@example.com' }), PublishError);
  assert.deepEqual(
    resolveIdentity({ PUBLISH_NAME: 'x', PUBLISH_EMAIL: '1+x@users.noreply.github.com' }),
    { name: 'x', email: '1+x@users.noreply.github.com' },
  );
  assert.deepEqual(
    resolveIdentity({}, () => ({ login: 'octo', id: 42 })),
    { name: 'octo', email: '42+octo@users.noreply.github.com' },
  );
  assert.equal(isNoreply('42+octo@users.noreply.github.com'), true);
  assert.equal(isNoreply('octo@users.noreply.github.com'), true);
  assert.equal(isNoreply('noreply@github.com'), true);
  assert.equal(isNoreply('dev@example.com'), false);
  assert.equal(isNoreply('someone@example.org'), false);
});

test('引数: 既定は試し実行。不明なオプションは拒否する', () => {
  assert.deepEqual(parseArgs([]), { push: false, force: false, skipTests: false, branch: 'master', help: false });
  assert.deepEqual(
    parseArgs(['--push', '--force', '--skip-tests', '--branch=main']),
    { push: true, force: true, skipTests: true, branch: 'main', help: false },
  );
  assert.throws(() => parseArgs(['--pussh']), PublishError);
});

test('スクリプト: 個人情報(メール・名前)を、スクリプト自身に書いていない', () => {
  const source = fs.readFileSync(new URL('../scripts/publish.js', import.meta.url), 'utf8');
  assert.ok(!/@gmail\.com|@outlook|@yahoo/i.test(source));
  assert.ok(/--push/.test(source) && /試し実行/.test(source));
});
