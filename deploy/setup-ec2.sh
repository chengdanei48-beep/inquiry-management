#!/bin/bash
# EC2(Amazon Linux 2023)で、問い合わせ管理を、常駐サービスとして起動する。
# root で実行する(EC2 の「ユーザーデータ」から実行するか、sudo bash で実行する)。
#
# 必須の環境変数:
#   APP_PASSWORD  認証のパスワード(12 文字以上。画面を開くときに入力する)
# 任意の環境変数:
#   APP_USER      認証のユーザー名(既定: admin)
#   REPO_URL      取得するリポジトリ(既定: 公開リポジトリ)
#   REF           取得するタグ・ブランチ(既定: main)
#
# 何度実行しても、同じ結果になる(再実行で、コードを更新できる。データは消さない)。
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/chengdanei48-beep/inquiry-management.git}"
REF="${REF:-main}"
APP_USER="${APP_USER:-admin}"
APP_DIR=/opt/inquiry-management
NODE_LINK=/opt/node
ENV_FILE=/etc/inquiry-management.env
DATA_DIR=/var/lib/inquiry-management

log() { echo "[setup] $*"; }

if [ "$(id -u)" -ne 0 ]; then echo "root で実行してください(sudo bash deploy/setup-ec2.sh)" >&2; exit 1; fi
if [ -z "${APP_PASSWORD:-}" ] || [ "${#APP_PASSWORD}" -lt 12 ]; then
  echo "APP_PASSWORD(12 文字以上)を、環境変数で指定してください" >&2
  exit 1
fi
# 設定ファイルに、そのまま書けるよう、使える文字を限定する(英数字と . _ @ + = , / -)
if ! [[ "$APP_PASSWORD" =~ ^[A-Za-z0-9._@+=,/-]+$ ]]; then
  echo "APP_PASSWORD に使える文字は、英数字と . _ @ + = , / - だけです" >&2
  exit 1
fi

# 1. 必要なコマンド
log "パッケージを確認します"
dnf install -y git tar xz >/dev/null

# 2. Node.js 24(公式のバイナリ。チェックサムを確認する)
if [ ! -x "$NODE_LINK/bin/node" ] || ! "$NODE_LINK/bin/node" --version | grep -q '^v24\.'; then
  case "$(uname -m)" in
    x86_64) NODE_ARCH=linux-x64 ;;
    aarch64) NODE_ARCH=linux-arm64 ;;
    *) echo "未対応の CPU: $(uname -m)" >&2; exit 1 ;;
  esac
  log "Node.js 24 を取得します($NODE_ARCH)"
  BASE=https://nodejs.org/dist/latest-v24.x
  TMP="$(mktemp -d)"
  curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  FILE="$(grep -E " node-v24\.[0-9.]+-$NODE_ARCH\.tar\.xz\$" "$TMP/SHASUMS256.txt" | awk '{print $2}' | head -n1)"
  [ -n "$FILE" ] || { echo "Node.js 24 のファイルが見つかりません" >&2; exit 1; }
  curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE"
  (cd "$TMP" && grep " $FILE\$" SHASUMS256.txt | sha256sum -c -)
  mkdir -p /opt
  tar -xJf "$TMP/$FILE" -C /opt
  ln -sfn "/opt/${FILE%.tar.xz}" "$NODE_LINK"
  rm -rf "$TMP"
fi
log "Node.js: $("$NODE_LINK/bin/node" --version)"

# 3. 実行用のユーザー(ログインできない)
id inquiry >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin inquiry

# 4. アプリのコード(指定のタグ・ブランチ)
if [ -d "$APP_DIR/.git" ]; then
  log "コードを更新します($REF)"
  git -C "$APP_DIR" fetch --tags --depth 1 origin "$REF"
  git -C "$APP_DIR" checkout -q --force FETCH_HEAD
else
  log "コードを取得します($REPO_URL @ $REF)"
  git clone --depth 1 --branch "$REF" "$REPO_URL" "$APP_DIR"
fi

# 5. 設定ファイル(パスワードを含む。root だけが読める)
umask 077
cat > "$ENV_FILE" <<ENVEOF
HOST=0.0.0.0
PORT=80
APP_USER=$APP_USER
APP_PASSWORD=$APP_PASSWORD
ALLOWED_HOSTS=*
DB_PATH=$DATA_DIR/inquiry.db
ENVEOF
chmod 600 "$ENV_FILE"
umask 022

# 6. データの置き場所と、サンプルデータ(DB が無いときだけ)
mkdir -p "$DATA_DIR"
chown inquiry:inquiry "$DATA_DIR"
if [ ! -f "$DATA_DIR/inquiry.db" ]; then
  log "サンプルデータを登録します"
  (set -a; . "$ENV_FILE"; set +a; cd "$APP_DIR" && runuser -u inquiry -- env DB_PATH="$DATA_DIR/inquiry.db" "$NODE_LINK/bin/node" scripts/seed.js)
else
  log "データベースが既にあるため、サンプルデータは登録しません"
fi

# 7. 常駐サービス
install -m 644 "$APP_DIR/deploy/inquiry-management.service" /etc/systemd/system/inquiry-management.service
systemctl daemon-reload
systemctl enable inquiry-management >/dev/null 2>&1
systemctl restart inquiry-management

# 8. 動作確認(ヘルスチェック)
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1/healthz >/dev/null 2>&1; then
    log "起動しました。 http://<このサーバーのパブリック IP>/ を開き、ユーザー名 $APP_USER とパスワードでログインしてください"
    exit 0
  fi
  sleep 1
done
echo "起動を確認できませんでした。 journalctl -u inquiry-management で、ログを確認してください" >&2
exit 1
