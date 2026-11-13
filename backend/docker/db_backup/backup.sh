#!/bin/sh
# 資料庫異地備份：pg_dump（-Fc 自訂格式，已壓縮）→ 上傳 S3。
#
# 兩種模式：
#   常駐（compose 的 backup service）：啟動時先備份一次，之後每 BACKUP_INTERVAL_SECONDS 一次。
#   單次（BACKUP_ONESHOT=1，`make prod-backup` / CD 部署前）：備份一次，結果反映在 exit code。
#
# 環境變數（由 docker-compose.prod.yml 從 .env.prod 帶入）：
#   DATABASE_URL            同 app 的連線字串（postgresql://user:pass@host:5432/db?sslmode=require）
#   BACKUP_S3_URI           s3://bucket/prefix；留空 = 停用（只印警告，單次模式 exit 0）
#   BACKUP_INTERVAL_SECONDS 常駐模式的間隔，預設 86400
#   BACKUP_HEARTBEAT_URL    選填：每次成功後 GET 一次（healthchecks.io 等）。備份失敗不會有任何
#                           例外或錯誤事件，只能靠「該來的 ping 沒來」偵測，見 docs/alerting.md
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  選填；留空就用 instance role（優先，不存 key）
#
# 保留期交給 bucket lifecycle rule，這裡不刪 S3 上的舊檔。
# 從容器啟動時間起算間隔，不對齊固定時刻；要固定時刻（例如凌晨）就改用主機 cron 呼叫 make prod-backup。
set -u

TMP_DIR="${TMPDIR:-/tmp}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
ONESHOT="${BACKUP_ONESHOT:-0}"
FILE_PREFIX="${BACKUP_FILE_PREFIX:-db}"

log() { echo "$(date -u +%FT%TZ) [backup] $*"; }

# compose 把沒設定的 key 帶成空字串；空字串的 AWS_ACCESS_KEY_ID 會讓 aws-cli 以為有給 key、
# 不再往下找 instance role。沒給就整組拿掉。
if [ -z "${AWS_ACCESS_KEY_ID:-}" ]; then
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
fi

if [ -z "${BACKUP_S3_URI:-}" ]; then
  log "WARNING: BACKUP_S3_URI is not set - database backups are DISABLED"
  if [ "$ONESHOT" = "1" ]; then
    exit 0
  fi
  # 常駐模式：不要結束（restart: unless-stopped 會一直重啟洗 log），安靜待命。
  while true; do sleep 86400; done
fi

if [ -z "${DATABASE_URL:-}" ]; then
  log "ERROR: DATABASE_URL is not set"
  exit 1
fi

DEST="${BACKUP_S3_URI%/}"

backup_once() {
  name="${FILE_PREFIX}_$(date -u +%Y%m%d_%H%M%S).dump"
  file="$TMP_DIR/$name"
  # 傾印檔是未加密的完整資料庫：只有擁有者可讀，不論成敗都刪掉本機暫存。
  # 先寫暫存檔再上傳：pg_dump 中途失敗才不會在 S3 留下不完整、看起來卻正常的備份。
  # 不用 `pg_dump | gzip`：sh 沒有 pipefail，pg_dump 失敗時 gzip 照樣成功。
  umask 077
  if pg_dump --format=custom --no-owner --no-acl --dbname="$DATABASE_URL" --file="$file" \
    && aws s3 cp --only-show-errors "$file" "$DEST/$name"; then
    rm -f "$file"
    log "OK: uploaded $DEST/$name"
    if [ -n "${BACKUP_HEARTBEAT_URL:-}" ]; then
      wget -q -O /dev/null -T 10 "$BACKUP_HEARTBEAT_URL" || log "WARNING: heartbeat ping failed"
    fi
    return 0
  fi
  rm -f "$file"
  log "FAILED: $name"
  return 1
}

if [ "$ONESHOT" = "1" ]; then
  backup_once
  exit $?
fi

# docker stop 時立刻結束（sh 在前景執行 sleep 時不會處理 SIGTERM，要先把 sleep 放背景再 wait）。
trap 'log "stopping"; exit 0' TERM INT
while true; do
  backup_once || true
  sleep "$INTERVAL" &
  wait $!
done
