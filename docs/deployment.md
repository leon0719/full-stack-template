# 部署指南

## 架構

```
使用者 ──HTTPS──▶ CloudFront ──OAC──▶ S3（前端靜態檔）
   │
   └────HTTPS──▶ Cloudflare 橘雲 ──HTTPS──▶ caddy (443) ─▶ api（Docker）
                                                │
                                        外部 PostgreSQL / Redis
                                                ▲
                                     celery-worker / celery-beat
```

- 前端：Vite build 出的靜態檔放 S3，CloudFront 分發。
- 後端：單機 Docker Compose，對外經 Cloudflare 橘雲 + 內建 Caddy 反向代理
  （主機需開放 inbound 443）。
- 前後端**不同源**，靠後端 CORS 白名單放行前端 origin。

## 部署順序

1. 後端上線（Caddy 通、health check 過）
2. 前端部署（build 時注入 API 網域）
3. 端對端驗證

---

## 1. 後端

完整流程照 **[backend/docs/deployment.md](../backend/docs/deployment.md)**
（env 變數表、Cloudflare + Caddy 設定、更新與回滾）。在 `backend/` 目錄操作：

```bash
cd backend
cp .env.prod.example .env.prod && chmod 600 .env.prod
vim .env.prod        # 照 backend/docs/deployment.md 的必填表逐項填
make prod-build
make prod-up      # 先備份 DB（BACKUP_S3_URI 未設時只印警告），再 migrate、啟動
```

之後的更新可以手動（`make prod-backup` → `prod-build` → `prod-migrate` → `prod-up SKIP_BACKUP=1`），
或開啟 **後端 CD**：根目錄 `.github/workflows/backend-ci.yml` 的 `deploy` job，只在 repo variable
`DEPLOY_ENABLED=true`、push 到 `main`、且後端 CI 全綠時跑；它 SSH 進主機、快轉到 CI 驗過的 commit，
在 `backend/` 依序備份 → build → migrate → up，再輪詢 `/health/ready`。主機上要 clone **整個 monorepo**
（`DEPLOY_PATH` 指向 repo 根目錄）。設定步驟見
[backend/docs/deployment.md「自動部署（CD）」](../backend/docs/deployment.md#自動部署cd)。
CD 只管後端；只改前端的 push 不會觸發（`paths` 過濾），前端照下方第 2 節手動部署。

其中**與前端串接直接相關**的變數（填錯最常見的症狀是 CORS 錯誤）：

| 變數 | 填什麼 | 範例 |
| --- | --- | --- |
| `CORS_ALLOWED_ORIGINS` | **前端**的對外 origin（CloudFront 網域或自訂網域,含 https://,不含路徑） | `https://app.your-domain.com` |
| `ALLOWED_HOSTS` | **API** 對外域名 | `api.your-domain.com` |
| `CSRF_TRUSTED_ORIGINS` | API 自己的 https origin（admin 用） | `https://api.your-domain.com` |

匯出端點（`GET /articles/export`）的檔名靠 `Content-Disposition`，後端已用 `CORS_EXPOSE_HEADERS`
開放給前端 origin 讀取——不用額外設定，但若在 Caddy/nginx/CloudFront 前面改寫 CORS header，要保留它。

**LINE 推播（選用）**：通知要推到使用者的 LINE 時，另外建一個 **Messaging API channel**，填
`LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` / `LINE_MESSAGING_CHANNEL_SECRET`，webhook URL 設
`https://api.<domain>/notifications/line/webhook`。它和 LINE Login channel **必須在同一個 provider**
底下——LINE userId 是 per-provider，不同 provider 時 `LineProfile` 存的 userId 推不到同一個人。

驗證：`curl -i https://api.your-domain.com/health/live` 應為 200。

## 2. 前端（S3 + CloudFront）

### 一次性設定（AWS 端）

1. **S3 bucket**：建 bucket（如 `my-app-frontend`），**Block all public access
   維持開啟**——存取一律經 CloudFront OAC，不開放 bucket 公開讀取。
2. **CloudFront distribution**：
   - Origin：上面的 S3 bucket，Origin access 選 **Origin access control
     (OAC)**，建立 OAC 後把 CloudFront 產生的 bucket policy 貼回 S3。
   - Viewer protocol policy：**Redirect HTTP to HTTPS**。
   - Default root object：`index.html`。
   - **SPA fallback**（前端路由直連/重新整理必須）：Error pages 加兩條
     custom error response——403 與 404 都導到 `/index.html`、
     response code 200、TTL 0。
   - Cache policy：預設 `CachingOptimized` 即可（快取行為由物件的
     Cache-Control 控制：hashed assets immutable、index.html no-cache，
     部署腳本已設好）。
3. **自訂網域（建議）**：ACM（**us-east-1**）簽發憑證 → distribution 加
   Alternate domain name → DNS 加 CNAME/alias 指向 CloudFront。
4. 記下 **bucket 名稱**與 **Distribution ID**（如 `E1ABCDEF234567`）。

### 每次部署

```bash
FRONTEND_S3_BUCKET=my-app-frontend \
CLOUDFRONT_DISTRIBUTION_ID=E1ABCDEF234567 \
VITE_API_BASE_URL=https://api.your-domain.com \
make deploy-frontend
```

腳本做的事：`bun run build`（把 `VITE_API_BASE_URL` 打進 bundle）→
`aws s3 sync`（`assets/*` 長快取 immutable、其餘 no-cache、sourcemap 不上傳）→
CloudFront invalidation。

> `VITE_API_BASE_URL` 會被打包進前端 bundle 且**改了就要重新 build**，
> 不能只改環境變數不重部。

### 部署後驗證

```bash
# 1. 首頁（應 200,content-type text/html）
curl -sI https://app.your-domain.com | head -5
# 2. SPA fallback（深連結應回 index.html 而非 403/404）
curl -sI https://app.your-domain.com/login | head -3
# 3. 端對端:瀏覽器開前端 → 登入 → header 顯示使用者名稱,
#    DevTools Network 應看到對 api.your-domain.com 的請求且無 CORS 錯誤
```

## 3. 上線檢核清單

- [ ] 後端 `make prod-up` 成功，Cloudflare SSL mode 為 Full 且 caddy 已簽出憑證
- [ ] `https://api.<domain>/health/live` 回 200
- [ ] `.env.prod` 的 `CORS_ALLOWED_ORIGINS` = 前端 origin（含 https://）
- [ ] migrate 已跑（prod compose 的 migrate job 會自動先跑）
- [ ] 前端 build 用的 `VITE_API_BASE_URL` = API 對外網域
- [ ] CloudFront SPA fallback（403/404 → /index.html）已設
- [ ] LINE Developers Console 的 Callback URL 已設為
      `https://api.<domain>/accounts/line/login/callback/`（見
      [backend/docs/deployment.md](../backend/docs/deployment.md) 步驟 3.5）
- [ ] `.env.prod` 的 `LINE_LOGIN_CHANNEL_ID` / `LINE_LOGIN_CHANNEL_SECRET` /
      `FRONTEND_BASE_URL` 已填（`_validate_prod` 缺一即拒絕開機）
- [ ] 瀏覽器完成 LINE 登入 → me → logout 流程，無 CORS/mixed-content 錯誤
- [ ] 第一個管理員：`createsuperuser` 或在 `/admin/` 把某個 LINE 帳號加進 `admin` group；
      該帳號 `GET /auth/me` 的 `roles` 含 `admin`，前端 `<RequireRole>` 頁面看得到
- [ ] （有用 LINE 推播時）Messaging API channel 與 LINE Login channel 在同一個 provider，
      `LINE_MESSAGING_*` 已填、webhook URL 已設並在 LINE Console 按過 Verify
- [ ] DB 備份：託管 DB 的 PITR 已開；`BACKUP_S3_URI` 已設（或明確決定只靠 PITR），並演練過一次還原
      （[backend/docs/deployment.md「備份與還原」](../backend/docs/deployment.md#備份與還原)）
- [ ] （開 CD 時）`DEPLOY_ENABLED` / `DEPLOY_PATH` variables 與 `DEPLOY_*` secrets 已設，
      `production` environment 視需要加 required reviewers
- [ ] （建議）`/admin/` 已用 Caddyfile 的 IP allowlist 保護
      （見 [backend/docs/caddy.md](../backend/docs/caddy.md)）

### 告警（前後端都要）

出錯沒人知道，等於沒有監控。完整步驟與檢查清單見
**[backend/docs/alerting.md](../backend/docs/alerting.md)**。

- [ ] 後端 `SENTRY_DSN` 已填（`ENV=prod` 留空會直接拒絕開機）
- [ ] 前端 build 時的 `VITE_SENTRY_DSN` 已填
- [ ] Sentry 已接 Slack，且**實際觸發過一次測試事件確認收得到**
- [ ] 外部監控在打 `https://api.<domain>/health/ready`（不是 `/health/live`——
      它永遠回 200，拿來監控等於沒監控）
- [ ] `BEAT_HEARTBEAT_URL` 已填，監控端已看到第一次 ping
- [ ] repo secret `SLACK_WEBHOOK_URL` 已設（CI / CD 失敗通知）
- [ ] `BACKUP_HEARTBEAT_URL` 已填（備份失敗不會有任何錯誤事件）
