// 公開版の更新(npm run publish:public)。
//
// 開発用(非公開)リポジトリの履歴を、個人のメールアドレス・名前を隠して、公開リポジトリへ反映する。
//   1. 作業用のクローンを作り、作者・コミッターのメールを GitHub の noreply に置き換え、
//      名前を GitHub のアカウント名に統一した履歴を作る(日時・内容・メッセージは変えない)。
//   2. 書き換えた履歴を検証する(個人情報が残っていないこと、内容が開発用と一致すること、テスト)。
//   3. 公開リポジトリへ反映する。既定は「試し実行」(何も push しない)。--push で反映する。
//
// 個人のメールアドレス・名前は、このスクリプトに書かない(公開されるファイルのため)。
// 開発用の履歴から、noreply 以外の作者・コミッターを自動で検出して、置き換える。
// 同じ入力・同じ置き換えなら、同じコミットID になるため、2回目以降の反映は通常の push(fast-forward)になる。
//
// 使い方:
//   npm run publish:public                  試し実行(検証だけ)
//   npm run publish:public -- --push        公開リポジトリへ反映する
//   オプション: --branch=<名前>(既定 master)  --skip-tests  --force(食い違いを上書きする)
// 環境変数:
//   PUBLISH_PUBLIC_URL  公開リポジトリのURL(既定: https://github.com/<アカウント>/<package.json の name>.git)
//   PUBLISH_NAME / PUBLISH_EMAIL  公開する作者名・メール(既定: gh api user から。メールは noreply のみ許可)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOREPLY_RE = /^(\d+\+)?[A-Za-z0-9-]+@users\.noreply\.github\.com$/;
const GITHUB_WEB_COMMITTER = { name: 'GitHub', email: 'noreply@github.com' };

export class PublishError extends Error {}

function git(cwd, args, { env, allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', FILTER_BRANCH_SQUELCH_WARNING: '1', ...env },
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch (err) {
    if (allowFail) return null;
    const detail = `${err.stderr ?? ''}${err.stdout ?? ''}`.trim();
    throw new PublishError(`git ${args.slice(0, 3).join(' ')} に失敗しました: ${detail || err.message}`);
  }
}

/** noreply(GitHub が用意する、個人のメールを隠すアドレス)か。 */
export function isNoreply(email) {
  return NOREPLY_RE.test(email) || email === GITHUB_WEB_COMMITTER.email;
}

export function parseArgs(argv) {
  const opts = { push: false, force: false, skipTests: false, branch: 'master', help: false };
  for (const a of argv) {
    if (a === '--push') opts.push = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--skip-tests') opts.skipTests = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('--branch=')) opts.branch = a.slice('--branch='.length);
    else throw new PublishError(`不明なオプションです: ${a}`);
  }
  return opts;
}

/** 公開する作者名・メール。メールは noreply だけを許可する(個人のメールを公開しないため)。 */
export function resolveIdentity(env = process.env, ghUser = readGhUser) {
  let { PUBLISH_NAME: name, PUBLISH_EMAIL: email } = env;
  if (!name || !email) {
    const user = ghUser();
    name = name || user.login;
    email = email || `${user.id}+${user.login}@users.noreply.github.com`;
  }
  if (!NOREPLY_RE.test(email)) {
    throw new PublishError(`公開するメールアドレスは、GitHub の noreply(…@users.noreply.github.com)だけを指定できます: ${email}`);
  }
  if (!name.trim()) throw new PublishError('公開する作者名が空です');
  return { name, email };
}

function readGhUser() {
  try {
    const out = execFileSync('gh', ['api', 'user', '-q', '{login: .login, id: .id}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const user = JSON.parse(out);
    if (!user.login || !user.id) throw new Error('アカウント情報を取得できません');
    return user;
  } catch (err) {
    throw new PublishError(`GitHub のアカウント情報を取得できません(gh auth login が必要です。または PUBLISH_NAME と PUBLISH_EMAIL を指定してください): ${err.message}`);
  }
}

function readPackageName(repoDir) {
  return JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8')).name;
}

/** 履歴にある、noreply 以外の作者・コミッター(名前・メール)。置き換え後に、残っていないことを確認する。 */
function collectOriginals(repoDir, identity) {
  const out = git(repoDir, ['log', '--branches', '--tags', '--format=%an%n%ae%n%cn%n%ce']);
  const values = new Set();
  const lines = out.split('\n');
  for (let i = 0; i < lines.length; i += 2) {
    const name = lines[i];
    const email = lines[i + 1];
    if (!email || isNoreply(email)) continue; // GitHub の noreply は、そのまま
    values.add(email);
    if (name && name !== identity.name && name !== GITHUB_WEB_COMMITTER.name) values.add(name);
  }
  // 公開する名前そのものは、残ってよい
  values.delete(identity.name);
  return [...values].filter((v) => v.length >= 3);
}

// git filter-branch の --env-filter(sh)。個人情報はここに書かず、環境変数で受け取る。
const ENV_FILTER = `
is_noreply() { case "$1" in *@users.noreply.github.com|noreply@github.com) return 0;; esac; return 1; }
if ! is_noreply "$GIT_AUTHOR_EMAIL"; then export GIT_AUTHOR_EMAIL="$PUBLISH_EMAIL"; fi
if ! is_noreply "$GIT_COMMITTER_EMAIL"; then export GIT_COMMITTER_EMAIL="$PUBLISH_EMAIL"; fi
if [ "$GIT_AUTHOR_NAME" != "GitHub" ]; then export GIT_AUTHOR_NAME="$PUBLISH_NAME"; fi
if [ "$GIT_COMMITTER_NAME" != "GitHub" ]; then export GIT_COMMITTER_NAME="$PUBLISH_NAME"; fi
true
`;

function countCommits(dir, range) {
  return Number(git(dir, ['rev-list', '--count', range]));
}

/** コミットのメタデータ・メッセージ・全リビジョンのファイル内容に、元の個人情報が残っていないこと。 */
function assertNoOriginals(dir, originals) {
  if (originals.length === 0) return;
  const meta = git(dir, ['log', '--branches', '--tags', '--format=%an%n%ae%n%cn%n%ce%n%B']);
  for (const value of originals) {
    if (meta.includes(value)) throw new PublishError('書き換え後の履歴のメタデータ・メッセージに、元の個人情報が残っています');
  }
  const revisions = git(dir, ['rev-list', '--branches', '--tags']).split('\n').filter(Boolean);
  const patterns = originals.flatMap((v) => ['-e', v]);
  for (let i = 0; i < revisions.length; i += 200) {
    const batch = revisions.slice(i, i + 200);
    const hit = git(dir, ['grep', '-I', '-l', '-i', '-F', ...patterns, ...batch], { allowFail: true });
    if (hit) {
      throw new PublishError(`ファイルの内容に、個人情報(メール・名前)が含まれています。公開しません:\n${hit.split('\n').slice(0, 5).join('\n')}`);
    }
  }
}

/**
 * 公開版を更新する。
 * @param {object} o
 * @param {string} [o.repoDir] 開発用リポジトリ
 * @param {string} [o.publicUrl] 公開リポジトリの URL(またはパス)
 * @param {{name: string, email: string}} [o.identity]
 * @param {string} [o.branch]
 * @param {boolean} [o.push] 反映する(既定は試し実行)
 * @param {boolean} [o.force] 食い違いを上書きする
 * @param {boolean} [o.skipTests]
 * @param {(line: string) => void} [o.log]
 * @returns {{ action: 'create'|'fast-forward'|'up-to-date'|'diverged', newCommits: number, tags: string[], pushed: boolean }}
 */
export function publish({
  repoDir = ROOT, publicUrl, identity, branch = 'master', push = false, force = false, skipTests = false, log = () => {},
} = {}) {
  const id = identity ?? resolveIdentity();
  const url = publicUrl ?? process.env.PUBLISH_PUBLIC_URL
    ?? `https://github.com/${id.email.replace(/^\d+\+/, '').replace(/@.*$/, '')}/${readPackageName(repoDir)}.git`;

  // ----- 事前確認 -----
  const current = git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (current !== branch) throw new PublishError(`現在のブランチは ${current} です。${branch} に切り替えてから実行してください`);
  if (git(repoDir, ['status', '--porcelain'])) throw new PublishError('未コミットの変更があります。コミットするか、元に戻してから実行してください');
  const remote = git(repoDir, ['remote'], { allowFail: true });
  if (remote && remote.split('\n').includes('origin')) {
    git(repoDir, ['fetch', '-q', 'origin']);
    const local = git(repoDir, ['rev-parse', branch]);
    const upstream = git(repoDir, ['rev-parse', `origin/${branch}`], { allowFail: true });
    if (upstream && local !== upstream) {
      throw new PublishError(`${branch} が origin/${branch} と一致しません。push または pull してから実行してください`);
    }
  }

  const originals = collectOriginals(repoDir, id);
  log(`公開する作者: ${id.name} <${id.email}>`);
  log(`置き換える個人情報(名前・メール): ${originals.length} 件を検出`);

  // ----- 書き換えた履歴を、作業用のクローンに作る -----
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'inquiry-publish-'));
  try {
    git(os.tmpdir(), ['clone', '-q', '--no-hardlinks', '--branch', branch, repoDir, work]);
    git(work, ['remote', 'remove', 'origin']); // 開発用へ誤って push しない
    git(work, ['filter-branch', '-f', '--env-filter', ENV_FILTER, '--tag-name-filter', 'cat', '--', '--branches', '--tags'], {
      env: { PUBLISH_NAME: id.name, PUBLISH_EMAIL: id.email },
    });
    fs.rmSync(path.join(work, '.git', 'refs', 'original'), { recursive: true, force: true });
    git(work, ['reflog', 'expire', '--expire=now', '--all']);
    git(work, ['gc', '-q', '--prune=now'], { allowFail: true });

    // ----- 検証 -----
    const people = git(work, ['log', '--branches', '--tags', '--format=%ae%n%ce']).split('\n').filter(Boolean);
    const bad = people.find((e) => !isNoreply(e));
    if (bad) throw new PublishError(`書き換え後の履歴に、noreply 以外のメールアドレスが残っています: ${bad}`);
    const sourceCount = countCommits(repoDir, branch);
    const rewrittenCount = countCommits(work, branch);
    if (sourceCount !== rewrittenCount) throw new PublishError(`コミット数が一致しません(開発用 ${sourceCount} / 書き換え後 ${rewrittenCount})`);
    const sourceTree = git(repoDir, ['rev-parse', `${branch}^{tree}`]);
    const rewrittenTree = git(work, ['rev-parse', `${branch}^{tree}`]);
    if (sourceTree !== rewrittenTree) throw new PublishError('最新の内容が、開発用と一致しません');
    assertNoOriginals(work, originals);
    log(`検証: コミット ${rewrittenCount} 件・最新の内容が開発用と一致・個人情報の残存なし`);

    if (!skipTests) {
      git(work, ['checkout', '-q', branch]);
      try {
        execFileSync('npm', ['test'], { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
        log('検証: 書き換え後の最新で、npm test が成功');
      } catch (err) {
        throw new PublishError(`書き換え後の最新で、npm test が失敗しました:\n${String(err.stdout ?? '').split('\n').slice(-15).join('\n')}`);
      }
    }

    // ----- 公開側との比較 -----
    git(work, ['remote', 'add', 'public', url]);
    const tip = git(work, ['rev-parse', branch]);
    const remoteHead = git(work, ['ls-remote', '--heads', 'public', branch], { allowFail: true });
    let action;
    let newCommits;
    if (remoteHead === null) throw new PublishError(`公開リポジトリに接続できません: ${url}`);
    if (!remoteHead) {
      action = 'create';
      newCommits = rewrittenCount;
    } else {
      const remoteSha = remoteHead.split(/\s+/)[0];
      git(work, ['fetch', '-q', 'public', branch]);
      if (remoteSha === tip) {
        action = 'up-to-date';
        newCommits = 0;
      } else if (git(work, ['merge-base', '--is-ancestor', remoteSha, tip], { allowFail: true }) !== null) {
        action = 'fast-forward';
        newCommits = countCommits(work, `${remoteSha}..${tip}`);
      } else {
        action = 'diverged';
        newCommits = countCommits(work, tip);
      }
    }

    // タグ(開発用のタグを、書き換えた履歴の対応するコミットとして公開する)
    const tags = git(work, ['tag', '--list']).split('\n').filter(Boolean);
    const remoteTags = new Map();
    for (const line of (git(work, ['ls-remote', '--tags', 'public'], { allowFail: true }) ?? '').split('\n').filter(Boolean)) {
      const [sha, ref] = line.split(/\s+/);
      if (!ref.endsWith('^{}')) remoteTags.set(ref.replace('refs/tags/', ''), sha);
    }
    const tagPlan = tags.map((t) => {
      const local = git(work, ['rev-parse', `refs/tags/${t}`]);
      const remoteSha = remoteTags.get(t);
      return { tag: t, status: !remoteSha ? 'new' : remoteSha === local ? 'same' : 'conflict' };
    });

    const describe = {
      create: `公開リポジトリは空です。${newCommits} コミットを新規に反映します`,
      'fast-forward': `公開側に ${newCommits} コミットを追加します(通常の push)`,
      'up-to-date': '公開側は、書き換え後の履歴と一致しています。反映するものはありません',
      diverged: '公開側の履歴が、書き換え後の履歴と食い違っています(公開側にあるコミットが、書き換え後の履歴にありません)',
    }[action];
    log(`公開側との比較: ${describe}`);
    for (const t of tagPlan) log(`  タグ ${t.tag}: ${{ new: '新規', same: '一致', conflict: '公開側と異なるコミットを指している' }[t.status]}`);

    if (action === 'diverged' && !force) {
      throw new PublishError('公開側と食い違っているため、反映しません。内容を確認し、上書きしてよい場合だけ --force を付けてください');
    }
    const conflicts = tagPlan.filter((t) => t.status === 'conflict');
    if (conflicts.length > 0 && !force) {
      throw new PublishError(`公開側のタグと食い違っています(${conflicts.map((t) => t.tag).join(', ')})。上書きしてよい場合だけ --force を付けてください`);
    }

    const result = { action, newCommits, tags: tagPlan.filter((t) => t.status !== 'same').map((t) => t.tag), pushed: false };
    if (!push) {
      log('試し実行のため、何も反映していません(反映するには --push を付けます)');
      return result;
    }
    if (action === 'up-to-date' && result.tags.length === 0) return result;

    // ----- 反映 -----
    if (action !== 'up-to-date') {
      const args = ['push', 'public', `${branch}:${branch}`];
      if (action === 'diverged') {
        const remoteSha = remoteHead.split(/\s+/)[0];
        args.splice(1, 0, `--force-with-lease=${branch}:${remoteSha}`);
      }
      git(work, args);
    }
    for (const t of tagPlan.filter((x) => x.status !== 'same')) {
      git(work, ['push', ...(t.status === 'conflict' ? ['--force'] : []), 'public', `refs/tags/${t.tag}`]);
    }
    const after = git(work, ['ls-remote', '--heads', 'public', branch]).split(/\s+/)[0];
    if (after !== tip) throw new PublishError('反映後の公開側の先頭が、想定と一致しません');
    log(`反映しました: ${branch} → ${after.slice(0, 7)}`);
    result.pushed = true;
    return result;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ----- コマンドライン -----
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log('使い方: npm run publish:public [-- --push] [--branch=master] [--skip-tests] [--force]\n既定は試し実行です。詳細は scripts/publish.js の先頭を参照してください。');
      process.exit(0);
    }
    const result = publish({ ...opts, log: (line) => console.log(line) });
    console.log(`\n結果: ${result.action}(新しいコミット ${result.newCommits} 件、${result.pushed ? '反映済み' : '未反映'})`);
  } catch (err) {
    console.error(`\nエラー: ${err.message}`);
    process.exit(err instanceof PublishError ? 2 : 1);
  }
}
