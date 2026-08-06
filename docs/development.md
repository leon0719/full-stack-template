# 開發指南

前端本機 `bun run dev`（http://localhost:5173）＋ 後端 Docker `make up`
（http://localhost:8000）。dev 為跨源直連——後端 CORS dev 預設已允許
localhost:5173，**不需任何 proxy 或 CORS 設定**。

## 前置需求

| 工具 | 用途 | 安裝 |
| --- | --- | --- |
| Docker（compose v2） | 後端開發環境（API/DB/Redis/Celery） | macOS 可用 colima：`brew install colima docker docker-compose && colima start` |
| uv | 後端 Python 套件管理（本機 IDE/lint 用；跑在 Docker 不裝也行） | `brew install uv` |
| bun | 前端套件管理與開發伺服器 | `brew install oven-sh/bun/bun` |
| make | 指令入口 | macOS 內建 |

## 首次啟動（可逐行複製）

```bash
# 1. 後端環境變數（dev 有合理預設,通常照抄即可）
cp backend/.env.local.example backend/.env.local

# 2. 啟動後端（API + PostgreSQL + Redis + Celery）
make up
make migrate

# 3. 建立測試帳號（擇一）
#    a. 互動式管理員帳號:
make createsuperuser
#    b. 或用 API 註冊一般帳號:
curl -s -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","email":"alice@example.com","password":"pw12345678"}'

# 4. 前端
cd frontend && bun install && cd ..
make dev
```

開 http://localhost:5173 → 以剛建立的帳號登入 → header 應顯示登入者名稱。
這代表前後端串接成功（前端打的是真後端 `/auth/*`）。

## 日常指令

| 指令 | 說明 |
| --- | --- |
| `make up` / `make down` | 起停後端 Docker |
| `make logs` | 後端全服務日誌（單一服務見 `make -C backend help`） |
| `make migrate` | 資料庫遷移 |
| `make dev` | 前端開發伺服器（HMR） |
| `make check` | 前後端全部品質檢查（commit 前跑） |
| `make check-backend` | ruff format + lint + mypy + pytest（會自動修正 format/lint） |
| `make check-frontend` | biome + FSD 邊界 + tsc + vitest |

更深入的子專案指令與慣例：

- 後端：[backend/docs/local-development.md](../backend/docs/local-development.md)、`make -C backend help`
- 前端：[frontend/CLAUDE.md](../frontend/CLAUDE.md)（FSD 分層、新增 page 流程）

## 前後端如何串接

- **API base URL**：`frontend/.env.development` 設了
  `VITE_API_BASE_URL=http://localhost:8000`，dev 下前端直連後端。
  要覆蓋時在 `frontend/` 建 **`.env.development.local`**。注意 Vite 的優先序是
  mode 專屬檔勝過通用檔：`.env.development.local` > `.env.development` >
  `.env.local`，所以用 `.env.local` 覆蓋 dev 設定**不會生效**（會被
  `.env.development` 蓋掉）。
- **Auth**：`frontend/src/shared/auth/adapter/django-adapter.ts` 實作
  `AuthAdapter`（login/logout/me），對接後端 `apps/accounts` 的 opaque bearer
  token。`main.tsx` 啟動時 `setAuthAdapter(djangoAuthAdapter)`。
  - 後端 accounts 尚無角色概念，adapter 固定給 `roles: ["user"]`。
    要做 RBAC：後端加角色欄位 → adapter 的 `toUser()` 對映 → 前端
    `<RequireRole>` / `usePermission()` 即可用（前端已內建）。
- **CORS**：後端 dev 預設允許 `localhost:5173/3000`；改前端 port 時要同步改
  後端 `.env.local` 的 `CORS_ALLOWED_ORIGINS`。
- **API 文件**：http://localhost:8000/api/docs（互動式，可直接試打）。

### 新增一條「後端 endpoint + 前端呼叫」

1. 後端：照 [backend/CLAUDE.md](../backend/CLAUDE.md) 的分層加
   endpoint（或用 backend 的 `scaffold-app` / `add-resource` skill）。
2. 前端：在 page 的 `api/` segment 用 `@/shared/api` 的
   `apiGet/apiPost/...` 包 TanStack Query hook（已自動夾帶 Bearer token、
   401 自動清 session；或用 frontend 的 `scaffold-page` skill）。

## LINE 登入本地測試（cloudflared quick tunnel）

LINE Login 的 callback 需要公開 HTTPS URL，本機的 `localhost:8000` 無法直接註冊到
LINE Developers Console。用 cloudflared 的 quick tunnel 暫時開一個公開網址：

1. 啟動後端：`make up`
2. 啟動 tunnel（另開一個 terminal）：
   ```bash
   cloudflared tunnel --url http://localhost:8000
   ```
   輸出會有一行 `https://<random>.trycloudflare.com` —— 這就是這次測試要用的網址。
3. 更新 `backend/.env.local`：
   - `ALLOWED_HOSTS` 加上該 tunnel hostname（例如
     `localhost,127.0.0.1,0.0.0.0,host.docker.internal,<random>.trycloudflare.com`）
   - 重啟後端讓設定生效：`make down && make up`
4. 到 [LINE Developers Console](https://developers.line.biz/console/) 的對應 Channel，
   把 Callback URL 設為 `https://<random>.trycloudflare.com/accounts/line/login/callback/`
5. 更新前端 `frontend/.env.development.local`（沒有就新建）：
   ```
   VITE_API_BASE_URL=https://<random>.trycloudflare.com
   ```
   **務必是 `.env.development.local`，不是 `.env.local`** —— Vite 的 mode 專屬檔
   優先權高於通用檔，寫在 `.env.local` 會被 `.env.development` 的
   `http://localhost:8000` 蓋掉，前端仍會打本機後端，`redirect_uri` 就會變成
   `http://localhost:8000/...`，LINE 回你 `400 Invalid redirect_uri value`。
6. 啟動前端：`make dev`，開 http://localhost:5173/login，點「使用 LINE 登入」。
   若 dev server 本來就開著，**必須重啟** —— Vite 只在啟動時讀 env 檔。
   驗證有吃到設定：
   ```bash
   curl -s http://localhost:5173/src/shared/config/env.ts | grep -o '"VITE_API_BASE_URL": "[^"]*"'
   ```

**注意**：`backend/config/settings/local.py` 已設定信任 tunnel 傳來的
`X-Forwarded-Proto`（見該檔案註解），讓 allauth 產生的 `redirect_uri` 是
`https://` 而非 `http://`——若沒有這行，LINE 會拒絕請求並回報
`redirect_uri` 不符（因為 Console 上註冊的是 `https://` 開頭的 callback
URL）。這是 dev-only 設定，正式環境走 `prod.py` 各自的等效機制。

**注意**：quick tunnel 每次啟動網址都會變。每次重新測試都要重複步驟 2-5
（更新 `ALLOWED_HOSTS`、LINE Console 的 Callback URL、前端 `VITE_API_BASE_URL`）。
若要固定網址（省去每次更新的麻煩），改用 cloudflared 的具名 tunnel（需要一個
掛到 Cloudflare 的網域）：`cloudflared tunnel login && cloudflared tunnel create <name>`，
之後網址固定，只需設定一次。

## 疑難排解

| 症狀 | 原因 / 處理 |
| --- | --- |
| `make up` 失敗：cannot connect to Docker daemon | Docker 未啟動：`colima start` |
| port 8000 / 5173 被占用 | `lsof -i :8000` 找出佔用程序；或改 port（前端改 port 記得同步後端 CORS） |
| 登入時 browser console 出現 CORS 錯誤 | 後端沒起（`make logs`）；或前端不是跑在 5173/3000 |
| 登入回 429 | `/auth/login`、`/auth/register` 有 per-IP 節流，稍候再試 |
| API 回 500：relation does not exist | 忘了 `make migrate` |
| 前端顯示已登出（token 失效） | 後端 `make down -v` / token 過期屬正常；重新登入即可 |
| `make check-backend` / `test-local` 資料庫連不上 | `backend/.env.local` 是給容器內用的（`db`/`redis` 主機名）；host 端跑測試請把 `DATABASE_URL` 改為 `postgresql://app:app@localhost:5433/app`（Redis 同理改 `localhost`），或刪掉 `.env.local` 後以 `DATABASE_URL="sqlite://:memory:" make -C backend test-local` 跑記憶體 SQLite（CI 即如此） |
