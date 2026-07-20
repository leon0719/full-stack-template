# 部署指南

## 架構

```
使用者 ──HTTPS──▶ CloudFront ──OAC──▶ S3（前端靜態檔）
   │
   └────HTTPS──▶ Cloudflare edge ──tunnel──▶ cloudflared ─▶ api（Docker）
                                                │
                                        外部 PostgreSQL / Redis
                                                ▲
                                     celery-worker / celery-beat
```

- 前端：Vite build 出的靜態檔放 S3，CloudFront 分發。
- 後端：單機 Docker Compose，對外經內建 Cloudflare Tunnel（主機不開 inbound port）。
- 前後端**不同源**，靠後端 CORS 白名單放行前端 origin。

## 部署順序

1. 後端上線（Tunnel 通、health check 過）
2. 前端部署（build 時注入 API 網域）
3. 端對端驗證

---

## 1. 後端

完整流程照 **[backend/docs/deployment.md](../backend/docs/deployment.md)**
（env 變數表、Cloudflare Tunnel 設定、更新與回滾）。在 `backend/` 目錄操作：

```bash
cd backend
cp .env.prod.example .env.prod && chmod 600 .env.prod
vim .env.prod        # 照 backend/docs/deployment.md 的必填表逐項填
make prod-build
make prod-up
```

其中**與前端串接直接相關**的變數（填錯最常見的症狀是 CORS 錯誤）：

| 變數 | 填什麼 | 範例 |
| --- | --- | --- |
| `CORS_ALLOWED_ORIGINS` | **前端**的對外 origin（CloudFront 網域或自訂網域,含 https://,不含路徑） | `https://app.your-domain.com` |
| `ALLOWED_HOSTS` | **API** 對外域名 | `api.your-domain.com` |
| `CSRF_TRUSTED_ORIGINS` | API 自己的 https origin（admin 用） | `https://api.your-domain.com` |

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

- [ ] 後端 `make prod-up` 成功，Cloudflare Tunnel 顯示 HEALTHY
- [ ] `https://api.<domain>/health/live` 回 200
- [ ] `.env.prod` 的 `CORS_ALLOWED_ORIGINS` = 前端 origin（含 https://）
- [ ] migrate 已跑（prod compose 的 migrate job 會自動先跑）
- [ ] 前端 build 用的 `VITE_API_BASE_URL` = API 對外網域
- [ ] CloudFront SPA fallback（403/404 → /index.html）已設
- [ ] 瀏覽器完成 login → me → logout 流程，無 CORS/mixed-content 錯誤
- [ ] （建議）`/admin/` 已用 Cloudflare Zero Trust Access 保護
      （見 [backend/docs/cloudflare-tunnel.md](../backend/docs/cloudflare-tunnel.md)）
