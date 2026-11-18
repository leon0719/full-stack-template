# 部署指南（單機 Docker Compose）

生產部署走 `docker/docker-compose.prod.yml`：單一主機、外部 DB/Redis、
對外流量經 Cloudflare 橘雲 + 內建 Caddy 反向代理（詳見 [caddy.md](caddy.md)）。

## 架構

```
訪客 ──HTTPS──▶ Cloudflare 橘雲 ──HTTPS──▶ caddy (443) ─▶ api (uvicorn ×N workers)
                                                            │
                                           ┌────────────────┤
                                     外部 PostgreSQL   外部 Redis ◀── celery-worker / celery-beat
```

compose 內的服務：`migrate`（一次性 job，跑完其他服務才啟動，避免併發
migrate）、`api`、`celery-worker`、`celery-beat`、`backup`（DB 備份 sidecar，見
「備份與還原」）、`caddy`（改用主機 nginx 時刪掉，見 [nginx.md](nginx.md)）。
靜態檔由 whitenoise 直接服務（build 時已 `collectstatic`），不需要 nginx。

## 前置需求

- 主機裝好 Docker（含 compose v2）與 `make`、`git`。
- **外部 PostgreSQL 與 Redis**（RDS / Cloud SQL / Upstash 等，或自管）。
  prod compose 刻意不包含 DB/Redis——資料層的備份與升級不該跟 app 綁在一起。
  Redis 建議帶密碼 + TLS（`rediss://`）。
- 網域已加入 Cloudflare（A record 橘雲指向主機 IP、SSL mode 設 Full）、
  主機開放 inbound 443（細節與替代方案見 [caddy.md](caddy.md)）。

## `.env.prod` 環境變數

```bash
cp .env.prod.example .env.prod
chmod 600 .env.prod        # 內含機密
```

> 機密經 compose `env_file` 注入容器，能 `docker inspect` 的人都看得到——
> 單機、Docker 存取權受控時可接受；多人共用 daemon 請改 Docker secrets。

### 必填 — 缺了會啟動失敗或不安全

`ENV=prod` 時 `Settings` 有 fail-fast 驗證：placeholder `SECRET_KEY`（或長度
< 50）、殘留 dev 預設值的 `ALLOWED_HOSTS` / `CORS_ALLOWED_ORIGINS` /
`CELERY_BROKER_URL` / `CACHE_URL`，以及未設定的 `LINE_LOGIN_CHANNEL_ID` /
`LINE_LOGIN_CHANNEL_SECRET` / `FRONTEND_BASE_URL`（殘留 dev 預設
`http://localhost:5173`），都會**直接拒絕開機**並說明原因，
所以漏填會炸在啟動而不是上線後。

| 變數 | 範例 | 說明 |
| --- | --- | --- |
| `ENV` | `prod` | 選擇載入 `.env.prod`。必須由 process 環境提供（compose 的 `env_file` 即可）；裸機部署要先 `export ENV=prod` |
| `DJANGO_SETTINGS_MODULE` | `config.settings.prod` | 同上，非 `Settings` 欄位 |
| `SECRET_KEY` | `python -c "import secrets; print(secrets.token_urlsafe(50))"` 產生 | ≥ 50 字元，不可是 placeholder |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db?sslmode=require` | 外部託管 DB 保留 `sslmode=require`；同機 socket/私網才移除 |
| `ALLOWED_HOSTS` | `api.your-domain.com` | API 對外域名（逗號分隔可多個） |
| `CORS_ALLOWED_ORIGINS` | `https://app.your-domain.com` | 允許跨域呼叫的**前端** origin；同時會自動加進 CSRF 信任清單（瀏覽器帶 cookie 的寫入請求要過 Django 的 Origin 檢查）。**前端與 API 必須同一主網域**（例：`app.your-domain.com` + `api.your-domain.com`）——auth cookie 是 `SameSite=Lax`，不同主網域的前端瀏覽器不會帶上它，登入會無聲失效 |
| `CSRF_TRUSTED_ORIGINS` | `https://api.your-domain.com` | API **自己的** https origin（Django admin 的 CSRF 檢查用）；必須含 `https://` scheme。`CORS_ALLOWED_ORIGINS` 的前端 origin 會自動併入，**不用重複填** |
| `CELERY_BROKER_URL` | `rediss://:pass@host:6380/0` | 生產 Redis（帶密碼；公網務必 TLS） |
| `CACHE_URL` | `rediss://:pass@host:6380/1` | 與 broker 不同 DB index；throttle 計數器靠它 |
| `LINE_LOGIN_CHANNEL_ID` | LINE Developers Console → Channel → Basic settings 的 Channel ID | LINE Login channel（登入唯一入口，沒有帳密登入） |
| `LINE_LOGIN_CHANNEL_SECRET` | 同上 Channel secret | 同上 |
| `FRONTEND_BASE_URL` | `https://app.your-domain.com` | LINE 登入完成後導回前端的 origin（不可殘留 dev 預設 `http://localhost:5173`）；即 `AuthAdapter` 拿 exchange code 的 `/login/callback` 所在頁面 |
| `DOMAIN` | `api.your-domain.com` | Caddy 對外站台域名（[Cloudflare 端設定](caddy.md#步驟一cloudflare-端)）。compose 變數替換讀取，非 `Settings` 欄位 |
| `NINJA_NUM_PROXIES` | `2` | 信任的反代層數：Cloudflare edge + Caddy 共 2 層。**設錯 per-IP 節流會失效**，改變拓撲時必須重算 |
| `FORWARDED_ALLOW_IPS` | `172.16.0.0/12` | 信任哪些 proxy 的 `X-Forwarded-*`。預設值即對應內建 caddy（compose bridge 網段）；**設錯 per-IP 節流會失效**，換反代時必看 `.env.prod.example` 的說明 |
| `SENTRY_DSN` | Sentry 專案的 DSN | **prod 必填**，留空會拒絕開機。填了只做到「錯誤被記錄」，要通知到人還得建 Slack alert rule（見 [alerting.md](alerting.md)）。真的不用請填 `disabled` |

### 選填 — 有合理預設

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `WEB_CONCURRENCY` | CPU+1 | uvicorn worker 數 |
| `CELERY_CONCURRENCY` | `4` | 每個 worker 容器的 process 數（compose 變數替換） |
| `DB_CONN_POOL` | `false` | psycopg3 連線池。預設用持久連線（`CONN_MAX_AGE=600`＋健康檢查）已夠用；高併發、或 DB 連線數吃緊時再開 |
| `SENTRY_TRACES_SAMPLE_RATE` / `SENTRY_PROFILES_SAMPLE_RATE` | `0.1` / `0.0` | 效能追蹤與 profiling 的取樣率（`SENTRY_DSN` 本身是必填，見上表） |
| `BEAT_HEARTBEAT_URL` | 空（停用） | celery-beat 心跳的 ping URL。beat 掛掉是最安靜的故障，沒有這個就只能等人發現排程沒跑（見 [alerting.md](alerting.md)） |
| `CELERY_QUEUE_DEPTH_ALERT_THRESHOLD` | `1000` | 佇列積壓告警門檻。積壓時沒有任何任務會失敗，不主動量測不會知道。依實際流量調整 |
| `ARTICLE_PUBLISHED_WEBHOOK_URL` | 空（停用） | 文章發布 webhook 示範整合 |
| `AUTH_TOKEN_TTL_DAYS` 等 tuning | 見 `.env.prod.example` | token 效期、throttle rates、AuditLog 保留天數（`AUDIT_LOG_RETENTION_DAYS`）、分頁大小、匯出上限（`EXPORT_MAX_ROWS`）、通知重試/保留（`NOTIFICATION_*`）、job 保留（`JOB_RETENTION_DAYS`），皆有預設 |
| `EMAIL_HOST` 等 `EMAIL_*` / `DEFAULT_FROM_EMAIL` | 空（不寄信，只寫 log） | 通知 outbox 的 SMTP。設了 `EMAIL_HOST` 就必須把 `DEFAULT_FROM_EMAIL` 換成自己網域（仍是 `@example.com` 會拒絕開機），並設好 SPF/DKIM，否則信會被收件端默默丟掉 |
| `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` / `LINE_MESSAGING_CHANNEL_SECRET` | 空 | LINE **Messaging API** channel（不是 LINE Login 那個）：push（空 = 只寫 log）與 inbound webhook 驗簽（空 = webhook 回 503）。Messaging API channel 的 webhook URL：`https://<DOMAIN>/notifications/line/webhook`。要推播給 LINE 登入的使用者，兩個 channel 必須在同一個 provider 下（見 [integration-standards.md](integration-standards.md#通知email--line與-outbox)） |
| `BACKUP_S3_URI` 等 `BACKUP_*` | 空（停用備份） | DB 備份 sidecar，見下方「備份與還原」。非 `Settings` 欄位，compose 變數替換讀取 |
| `UVICORN_GRACEFUL_SHUTDOWN_TIMEOUT` / `CELERY_WORKER_SOFT_SHUTDOWN_TIMEOUT` | `30` / `30` | 收到 SIGTERM 後等進行中請求／任務的秒數，見下方「優雅關機」 |
| `UVICORN_TIMEOUT_KEEP_ALIVE` | `130` | uvicorn 閒置 keep-alive 秒數，必須大於反代對 upstream 的 keepalive（Caddy 2 分鐘），否則偶發 502 |

不用設的：`DEBUG`（settings module 固定，環境無法翻轉）、`GIT_COMMIT_SHA`
（`make prod-build` 自動以 build arg 注入）、`UVICORN_HOST`（compose 已處理，
只有裸機跨機反代才需要）。

## 部署步驟

```bash
# 1. 取得程式碼
git clone <repo-url> && cd django-ninja-project-tree

# 2. 設定環境變數（照上表填）
cp .env.prod.example .env.prod
chmod 600 .env.prod
vim .env.prod

# 3. Cloudflare 端：A record 橘雲指向本機 IP、SSL mode 設 Full；
#    主機防火牆開 443（步驟見 docs/caddy.md 步驟一）

# 3.5 LINE Developers Console → 對應 Channel → LINE Login → Callback URL
#     加上 https://api.your-domain.com/accounts/line/login/callback/
#     （少這一步，登入會在 LINE 端就被拒絕，Console 上會看到
#     redirect_uri 不符的錯誤）

# 4. 建置並啟動
make prod-build
make prod-up      # 先跑一次備份（BACKUP_S3_URI 未設時只印警告），migrate job 跑完 api/worker/beat 才會啟動

# 5. 匯入台灣辦公日曆（apps/holidays 的 is_working_day() 用；每年人事行政總處公告後再跑一次）
docker compose -f docker/docker-compose.prod.yml exec api python manage.py import_holidays 2027
```

### 驗證

```bash
make prod-logs                                  # 各服務啟動 log
curl -i http://127.0.0.1:8000/health/live      # 本機直測 api：應為 200
curl -i https://api.your-domain.com/health/live # 走 Cloudflare + Caddy：應為 200
```

再照 [caddy.md 步驟三](caddy.md#步驟三驗證)確認 SSL mode 正確、
log 看得到真實 client IP（per-IP 節流依賴此點）。

啟動失敗時先看 `make prod-logs`：`Settings` 驗證錯誤（SECRET_KEY／dev 預設值
殘留）會在 log 裡直接寫明是哪個變數。

### 建立管理員帳號

```bash
docker compose -f docker/docker-compose.prod.yml exec api python manage.py createsuperuser
```

（建議同時照 [caddy.md](caddy.md#保護-admin建議) 在 Caddyfile 加 IP
allowlist 保護 `/admin/`——它沒有 rate limit。）

## 更新部署

```bash
git pull
make prod-backup  # migration 沒有回頭路：先備份，失敗就停在這裡
make prod-build
make prod-migrate # 用新映像跑 migration，舊容器照常服務（migration 要 expand/contract 相容舊程式）
make prod-up SKIP_BACKUP=1
```

設定好 CD（下一節）之後，push 到 main 就會自動跑這一串。

回滾：`git checkout <前一個穩定 commit>` 後重跑 `make prod-build && make prod-up`。注意
migration 不會自動倒退——含 schema 變更的回滾需先評估該 migration 是否可逆，不可逆就從部署前的
備份還原（見「備份與還原」）。

## 自動部署（CD）

repo 根目錄 `.github/workflows/backend-ci.yml` 的 `deploy` job：**CI 所有 job 都通過、事件是 push 到 `main`、而且 repo
variable `DEPLOY_ENABLED` 是 `true`** 才會跑——模板預設不設這個 variable，所以 fork 出去的專案
不會意外部署到任何地方。流程：

1. SSH 進主機，`git merge --ff-only <這次 CI 驗過的 SHA>`（只快轉到驗過的 commit；主機上有人手改
   檔案或分支分岔時直接失敗，不會 reset 掉）
2. `make prod-backup` → `make prod-build` → `make prod-migrate` → `make prod-up SKIP_BACKUP=1`
3. 每 5 秒打一次 `http://127.0.0.1:8000/health/ready`，最多 `DEPLOY_HEALTH_RETRIES` 次（預設 30，
   約 2.5 分鐘）；一直不是 200 就印 `docker compose ps` 與 api/worker/beat/migrate 的最後 100 行
   log，job 失敗（`notify` job 會發 Slack）

同一時間只會有一個部署（`concurrency: deploy-production`），main 上的 CI 也不會因為新的 push
被取消（避免停在 migration 中間）。workflow 有 `paths: backend/**` 過濾：只改前端的 push 不會觸發後端部署，
前端照頂層 `docs/deployment.md` 用 `make deploy-frontend`（人工）部署。

### 設定

**主機（一次性）**

- 建一個部署專用帳號（例如 `deploy`），加入 `docker` group，能在 `DEPLOY_PATH` 執行 `git` 與 `make`；
  **整個 monorepo** 以 deploy key（唯讀）clone 到 `DEPLOY_PATH`（job 會 `cd backend` 再跑 `make prod-*`），
  `backend/.env.prod` 已就位。
- 產生一組 CI 專用 SSH key（`ssh-keygen -t ed25519 -f deploy_ci -N ""`），公鑰加進該帳號的
  `~/.ssh/authorized_keys`（可加 `from="..."` 限制來源）。

**GitHub（Settings → Secrets and variables → Actions；secrets 建議放在 `production` environment）**

| 種類 | 名稱 | 值 |
| --- | --- | --- |
| variable | `DEPLOY_ENABLED` | `true`（不設 = 不部署） |
| variable | `DEPLOY_PATH` | 主機上 monorepo 的根目錄（不是 `backend/`），例如 `/home/deploy/app` |
| variable | `DEPLOY_PORT` / `DEPLOY_HEALTH_RETRIES` | 選填，預設 `22` / `30` |
| secret | `DEPLOY_HOST` / `DEPLOY_USER` | 主機位址 / 部署帳號 |
| secret | `DEPLOY_SSH_KEY` | 上面產生的私鑰全文 |
| secret | `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan -p <port> <host>` 的輸出（**在可信任的網路上**取得後核對指紋）。刻意不用 `StrictHostKeyChecking=no`：否則 DNS 被劫持時部署指令會送到冒牌主機 |

`production` environment 可再加 required reviewers，讓每次部署都要有人按核准。

> nginx 站台設定（`docker/nginx/`）需要 sudo，**不在 CD 範圍**；改了要手動到主機套用（見 [nginx.md](nginx.md)）。

## 優雅關機

| 元件 | 收到 SIGTERM 後 | 設定 |
| --- | --- | --- |
| api（uvicorn） | 不再接新連線，等進行中的請求最多 `UVICORN_GRACEFUL_SHUTDOWN_TIMEOUT`（30s） | `uvicorn_run.py`；compose `stop_grace_period: 35s` 必須比它長。Dockerfile 用 exec form `CMD`，uvicorn 是 PID 1、直接收到訊號（shell form 或沒有 `exec` 的 entrypoint 腳本會讓 sh 吃掉 SIGTERM，最後被 SIGKILL） |
| celery-worker | `REMAP_SIGTERM=SIGQUIT` 讓 SIGTERM 走 cold shutdown 的 soft 階段：執行中的任務有 `CELERY_WORKER_SOFT_SHUTDOWN_TIMEOUT`（30s）可以完成，之後沒做完的**立刻退回佇列**（acks_late） | `config/settings/base.py`；compose `stop_grace_period: 60s` 必須比它長。代價：只要有任務在跑，關機就固定等滿這個秒數（Celery 的實作是 sleep）。不設的話（舊行為）任務會被 SIGKILL，Redis 要等 `visibility_timeout`（1h）才重送 |
| celery-beat | 立即結束 | 排程存在 DB，重啟後接續 |
| backup | 立即結束（備份做到一半的暫存檔會被丟棄，S3 上不會有不完整的檔案） | |


## 維運備忘

- **Log**：JSON 格式輸出到 stderr，json-file driver 已設輪替（10MB×3）。
  需要留存就接 log collector。
- **備份**：第一層是託管 DB 的**自動備份／PITR**（上線前確認已開）；第二層是 `backup`
  sidecar 每天一份 `pg_dump` 到**另一個帳號/region 的** S3（防託管服務本身出事、誤刪整個
  instance）。兩者都要**實際演練還原一次**——沒還原過的備份不算備份。步驟見下方「備份與還原」。
- **告警**：完整設定與上線檢查清單見 **[alerting.md](alerting.md)**。
  重點是它分兩類問題：Sentry 抓「程式壞了」，外部監控抓「服務不見了」——
  後者（beat 死掉、worker 沒起來、佇列積壓）不會產生任何 Sentry 事件，
  沉默和健康長得一模一樣，只能靠外部訊號偵測。
  `/health/ready` 要接 uptime 監控（不是 `/health/live`，它永遠回 200）。
- **依賴更新**：dependabot 每週開 PR（uv / GitHub Actions / Docker 三類）；
  CI 會跑 pip-audit 與 Trivy 掃描。

## 備份與還原

### 備份怎麼跑

- **常駐**：compose 的 `backup` service（`docker/db_backup/`）啟動時先備份一次，之後每
  `BACKUP_INTERVAL_SECONDS`（預設 24h）一次：`pg_dump --format=custom --no-owner --no-acl`
  → 上傳 `BACKUP_S3_URI/db_<UTC 時間>.dump`。先寫暫存檔、成功才上傳，中途失敗不會在 S3 留下殘檔。
- **單次**：`make prod-backup`（`make prod-up` 與 CD 在動到任何東西之前都會先跑）；失敗會中止後續步驟。
- **權限**：優先用主機的 instance role（EC2 instance profile），容器裡不存任何 key；非 AWS 主機才在
  `.env.prod` 填 `BACKUP_AWS_ACCESS_KEY_ID/SECRET`（region 用 `BACKUP_AWS_REGION`，預設 `ap-northeast-1`）。IAM policy 只給 `s3:PutObject` 到該 prefix——
  被入侵的主機刪不掉舊備份。
- **保留期**：交給 bucket 的 lifecycle rule（例如 `db-backups/` 365 天後刪除），腳本不刪檔。
  bucket 開 Block Public Access、預設加密（SSE-S3/KMS），可再開 Object Lock 防竄改。
- **告警**：備份失敗只會在容器 log 留一行 `FAILED`，不會有任何例外——請設 `BACKUP_HEARTBEAT_URL`
  （見 [alerting.md](alerting.md) 第 6 節）。
- `pg_dump` 版本是 18（`docker/db_backup/Dockerfile`），必須 >= 資料庫伺服器版本；DB 升到更新的
  大版本時一起改 base image。

### 還原流程

> 還原會**覆蓋**目標資料庫。正式環境還原前先停寫入（api/worker/beat），並再備份一次現況。

```bash
# 1. 取得要還原的備份（在有 S3 讀取權限的機器上；備份 sidecar 的 key 刻意沒有讀權限）
aws s3 ls s3://<bucket>/db-backups/ | tail
aws s3 cp s3://<bucket>/db-backups/db_20261113_030000.dump ./restore.dump

# 2. 先檢查內容（列出物件，不動資料庫）
pg_restore --list restore.dump | head

# 3. 停掉會寫 DB 的服務（保留 backup 以外的都停）
docker compose -f docker/docker-compose.prod.yml stop api celery-worker celery-beat

# 4. 還原到目標 DB（--clean --if-exists：先刪除同名物件再重建；--no-owner：物件歸連線的使用者）
#    pg_restore 版本要 >= 備份時的 pg_dump（18）；直接借 backup image 的 client 最省事
#    （image 名稱用 `docker compose -f docker/docker-compose.prod.yml images backup` 查）：
docker run --rm -i -v "$PWD/restore.dump:/tmp/restore.dump:ro" --entrypoint pg_restore \
  <backup image> --clean --if-exists --no-owner --no-acl --single-transaction \
  --dbname="postgresql://user:pass@host:5432/dbname?sslmode=require" /tmp/restore.dump

# 5. 若備份比目前程式碼舊：補跑 migration，再啟動服務並確認健康
make prod-migrate
docker compose -f docker/docker-compose.prod.yml start api celery-worker celery-beat
curl -fsS http://127.0.0.1:8000/health/ready
```

- **演練建議**：每季把最新備份還原到一個**臨時的** DB（不是正式環境），跑一次
  `python manage.py check` + 抽查幾張表筆數，確認備份真的能用。
- `--single-transaction`：任何一步失敗整個還原回滾，不會留下半套資料。
- 只想救回某幾張表：`pg_restore --list` 產生清單、編輯後用 `--use-list` 只還原需要的物件，
  還原到臨時 DB 再把資料搬回去，比直接覆蓋正式 DB 安全。

## 不用內建 Caddy 的話

改用主機 nginx 的取捨、站台設定範例（`docker/nginx/api.conf`）與
`FORWARDED_ALLOW_IPS` / `NINJA_NUM_PROXIES` 的對應調整見 [nginx.md](nginx.md)；
雲端 LB 的情況見 [caddy.md「不使用內建 Caddy 時」](caddy.md#不使用內建-caddy-時)。
