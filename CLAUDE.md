# CLAUDE.md

このファイルはこのリポジトリで作業する際にClaude Codeが厳守すべきルールを定める。

## 技術スタック
Node.js (v24 以降) + SQLite(Node.js 標準の `node:sqlite`) + HTML / 素のJavaScript

### 課金ルール(厳守)
課金が発生する技術・サービスは、原則として使わない。**既定は、ローカルだけで動作する構成(`npm start`)。**

- 使ってよい: Node.js の標準モジュール、無料のオープンソース(npm)。
- 使わない: 有料のDB・ホスティング・API、React / Java / PostgreSQL(課題の指示により不採用)。
- **例外(2026-10-13 に承認)**: 課題の提出必須要件(AWS へのデプロイ)のため、AWS の **EC2 を1台だけ**使う。ロードバランサー・RDS・Elastic IP などは使わない。請求のアラートを設定し、評価の後に削除する。AWS のアクセスキー・パスワードは、リポジトリに入れない。手順は [docs/aws-deployment.md](docs/aws-deployment.md)。
- 外部に公開するときは、**認証(`APP_PASSWORD`)を必須**とする(認証なしでは起動しない)。実データは入れず、サンプルデータだけを使う。
- 新しい依存を追加するときは、ライセンスが無料であることを確認する。標準モジュールで足りるときは依存を増やさない。

## 開発フロー(厳守)

### 1. 作業開始前に必ずGitHub Issueを作成する
機能追加・修正に着手する前に、`gh issue create` で目的・背景・完了条件を明記したIssueを起票する。Issue番号は以降のブランチ名・PRで参照する。

### 2. Issueごとに専用ブランチを作成する
masterから直接作業しない。必ずIssueに対応する専用ブランチを作成してから作業する。

命名規則: `種別/issue番号-概要`
- 種別: `feature`, `fix`, `chore`, `docs` など
- 例: `feature/12-add-login`, `fix/15-null-pointer`

### 3. masterへの直接pushは禁止。必ずPR経由でマージする
`git push origin master` のような直接pushは行わない。

作業完了後は `gh pr create` でPRを作成しマージする。PR本文にはIssue番号への参照(例: `Closes #12`)を含める。

レビュー承認は必須ではないが、PR作成とマージは必ず経由すること。

## 品質レビュー

PRを出す前や、全体を点検するときは、スキル `quality-review`(`.claude/skills/quality-review/SKILL.md`)のチェックリストに沿って確認する。結果は PR 本文に書く。
テストは `npm test` が通ること。

## 動作確認でのサーバー起動(厳守)

動作確認のためにサーバーを起動するときは、必ずアプリの既定ポートで起動する。ポートが競合しても、別のポートに逃げてはならない。

### 既定ポート

| 対象 | ポート | 定義箇所 |
|---|---|---|
| アプリ(Node.js サーバー) | 8080 | サーバーの `PORT` の既定値 |

### ルール
1. サーバーを起動する前に、既定ポートが使われていないか確認する。
2. **使われていた場合は、必ずそのポートを使っているプロセスを停止してから、既定ポートで起動する。** `PORT=8081` のような別ポートでの起動で回避することは禁止する。
3. 同じアプリのサーバーがすでに既定ポートで動いている場合も、最新のコードを反映するため、停止して起動し直す。
4. 停止したプロセス(PID・コマンドライン)は、作業報告でユーザーに伝える。
5. 起動後は、既定ポートで応答することを確認する(例: `http://localhost:8080/`)。

### ポートを使っているプロセスの停止(PowerShell)
```powershell
$port = 8080   # 対象のポート
$pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
foreach ($p in $pids) {
  Get-CimInstance Win32_Process -Filter "ProcessId=$p" | Select-Object ProcessId, Name, CommandLine  # 報告用に控える
  Stop-Process -Id $p -Force
}
```
停止後、ポートが解放されたこと(`Get-NetTCPConnection -LocalPort $port -State Listen` が何も返さないこと)を確認してから起動する。
