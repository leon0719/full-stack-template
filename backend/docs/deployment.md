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
migrate）、`api`、`celery-worker`、`celery-beat`、`caddy`。
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
| `CORS_ALLOWED_ORIGINS` | `https://your-frontend.com` | 允許跨域呼叫的**前端** origin |
| `CSRF_TRUSTED_ORIGINS` | `https://api.your-domain.com` | API **自己的** https origin（Django admin 的 CSRF 檢查用）；必須含 `https://` scheme |
| `CELERY_BROKER_URL` | `rediss://:pass@host:6380/0` | 生產 Redis（帶密碼；公網務必 TLS） |
| `CACHE_URL` | `rediss://:pass@host:6380/1` | 與 broker 不同 DB index；throttle 計數器靠它 |
| `LINE_LOGIN_CHANNEL_ID` | LINE Developers Console → Channel → Basic settings 的 Channel ID | LINE Login channel（登入唯一入口，沒有帳密登入） |
| `LINE_LOGIN_CHANNEL_SECRET` | 同上 Channel secret | 同上 |
| `FRONTEND_BASE_URL` | `https://your-frontend.com` | LINE 登入完成後導回前端的 origin（不可殘留 dev 預設 `http://localhost:5173`）；即 `AuthAdapter` 拿 exchange code 的 `/login/callback` 所在頁面 |
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
| `AUTH_TOKEN_TTL_DAYS` 等 tuning | 見 `.env.prod.example` | token 效期、throttle rates、分頁大小，皆有預設 |

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
make prod-up      # migrate job 先跑完，api/worker/beat 才會啟動
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
make prod-build
make prod-up      # 重建的 migrate job 先套新 migration，服務再滾動重啟
```

回滾：`git checkout <前一個穩定 commit>` 後重跑上面兩步。注意 migration
不會自動倒退——含 schema 變更的回滾需先評估該 migration 是否可逆。

## 維運備忘

- **Log**：JSON 格式輸出到 stderr，json-file driver 已設輪替（10MB×3）。
  需要留存就接 log collector。
- **備份**：DB/Redis 是外部服務，備份策略在那邊做（app 主機無狀態，
  重建即可）。
- **告警**：完整設定與上線檢查清單見 **[alerting.md](alerting.md)**。
  重點是它分兩類問題：Sentry 抓「程式壞了」，外部監控抓「服務不見了」——
  後者（beat 死掉、worker 沒起來、佇列積壓）不會產生任何 Sentry 事件，
  沉默和健康長得一模一樣，只能靠外部訊號偵測。
  `/health/ready` 要接 uptime 監控（不是 `/health/live`，它永遠回 200）。
- **依賴更新**：dependabot 每週開 PR（uv / GitHub Actions / Docker 三類）；
  CI 會跑 pip-audit 與 Trivy 掃描。

## 不用內建 Caddy 的話

自架 nginx（或雲端 LB）反代 `127.0.0.1:8000`，並刪除 `caddy` service——
步驟與 `FORWARDED_ALLOW_IPS` / `NINJA_NUM_PROXIES` 的對應調整見
[caddy.md「不使用內建 Caddy 時」](caddy.md#不使用內建-caddy-時)。
