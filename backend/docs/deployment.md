# 部署指南（單機 Docker Compose）

生產部署走 `docker/docker-compose.prod.yml`：單一主機、外部 DB/Redis、
對外流量經 Cloudflare Tunnel（詳見 [cloudflare-tunnel.md](cloudflare-tunnel.md)）。

## 架構

```
Cloudflare edge ──tunnel──▶ cloudflared ─▶ api (uvicorn ×N workers)
                                            │
                    ┌───────────────────────┤
              外部 PostgreSQL         外部 Redis ◀── celery-worker / celery-beat
```

compose 內的服務：`migrate`（一次性 job，跑完其他服務才啟動，避免併發
migrate）、`api`、`celery-worker`、`celery-beat`、`cloudflared`。
靜態檔由 whitenoise 直接服務（build 時已 `collectstatic`），不需要 nginx。

## 前置需求

- 主機裝好 Docker（含 compose v2）與 `make`、`git`。
- **外部 PostgreSQL 與 Redis**（RDS / Cloud SQL / Upstash 等，或自管）。
  prod compose 刻意不包含 DB/Redis——資料層的備份與升級不該跟 app 綁在一起。
  Redis 建議帶密碼 + TLS（`rediss://`）。
- 網域已加入 Cloudflare（Tunnel 用；不用 Cloudflare 的替代方案見文末）。

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
`CELERY_BROKER_URL` / `CACHE_URL`，都會**直接拒絕開機**並說明原因，
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
| `TUNNEL_TOKEN` | `eyJ...` | Cloudflare Tunnel token（[取得方式](cloudflare-tunnel.md#步驟一cloudflare-端--建立-tunnel)）。compose 變數替換讀取，非 `Settings` 欄位 |
| `FORWARDED_ALLOW_IPS` | `172.16.0.0/12` | 信任哪些 proxy 的 `X-Forwarded-*`。預設值即對應內建 cloudflared（compose bridge 網段）；**設錯 per-IP 節流會失效**，換反代時必看 `.env.prod.example` 的說明 |

### 選填 — 有合理預設

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `NINJA_NUM_PROXIES` | `1` | 信任的反代層數。Cloudflare Tunnel 維持 1；多一層 CDN/LB 就 +1，必須與 `FORWARDED_ALLOW_IPS` 對應同一套拓撲 |
| `WEB_CONCURRENCY` | CPU+1 | uvicorn worker 數 |
| `CELERY_CONCURRENCY` | `4` | 每個 worker 容器的 process 數（compose 變數替換） |
| `DB_CONN_POOL` | `false` | psycopg3 連線池。預設用持久連線（`CONN_MAX_AGE=600`＋健康檢查）已夠用；高併發、或 DB 連線數吃緊時再開 |
| `SENTRY_DSN` | 空（停用） | 填 DSN 即啟用錯誤追蹤；`SENTRY_TRACES_SAMPLE_RATE`（example 給 0.1）/ `SENTRY_PROFILES_SAMPLE_RATE`（0.0）控制取樣 |
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

# 3. Cloudflare 端建立 Tunnel、把 token 填進 .env.prod
#    （步驟見 docs/cloudflare-tunnel.md 步驟一）

# 4. 建置並啟動
make prod-build
make prod-up      # migrate job 先跑完，api/worker/beat 才會啟動
```

### 驗證

```bash
make prod-logs                                  # 各服務啟動 log
curl -i http://127.0.0.1:8000/health/live      # 本機直測 api：應為 200
curl -i https://api.your-domain.com/health/live # 走 Cloudflare：應為 200
```

再照 [cloudflare-tunnel.md 步驟三](cloudflare-tunnel.md#步驟三驗證)確認
tunnel HEALTHY、access log 看得到真實 client IP（per-IP 節流依賴此點）。

啟動失敗時先看 `make prod-logs`：`Settings` 驗證錯誤（SECRET_KEY／dev 預設值
殘留）會在 log 裡直接寫明是哪個變數。

### 建立管理員帳號

```bash
docker compose -f docker/docker-compose.prod.yml exec api python manage.py createsuperuser
```

（建議同時照 [cloudflare-tunnel.md](cloudflare-tunnel.md#保護-admin建議) 用
Zero Trust Access 保護 `/admin/`——它沒有 rate limit。）

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
- **監控**：`/health/ready` 會檢查 DB + cache + Celery（Celery 掛 = degraded
  但仍 200；DB/cache 掛 = 503），可接 uptime 監控。錯誤追蹤填 `SENTRY_DSN`
  即啟用。
- **依賴更新**：dependabot 每週開 PR（uv / GitHub Actions / Docker 三類）；
  CI 會跑 pip-audit 與 Trivy 掃描。

## 不用 Cloudflare 的話

自架 nginx/Caddy 反代 `127.0.0.1:8000`，並刪除 `cloudflared` service——
步驟與 `FORWARDED_ALLOW_IPS` / `NINJA_NUM_PROXIES` 的對應調整見
[cloudflare-tunnel.md「不使用 Cloudflare Tunnel 時」](cloudflare-tunnel.md#不使用-cloudflare-tunnel-時)。
