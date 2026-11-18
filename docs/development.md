# 開發指南

前端本機 `bun run dev`（http://localhost:5173）＋ 後端 Docker `make up`
（http://localhost:8000）。日常開發為跨源直連——後端 CORS dev 預設已允許
localhost:5173，**不需任何 proxy 或 CORS 設定**；只有「LINE 登入本地測試」要走 tunnel 時，
才會用到 Vite 的 proxy（見下方該節）。

**注意**：前端務必用 `http://localhost:5173` 開，不要用 `127.0.0.1:5173`——後者與
`localhost:8000` 是不同 site，`SameSite=Lax` 的 `auth` cookie 不會被帶上。本機的 `auth` cookie
綁在 `localhost` 這個 host（cookie 不分 port），會與你機器上其他 `localhost` 服務共用。

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

# 3. 建立管理員帳號（登入 /admin/ 用；API 沒有帳密登入，前端一律走 LINE Login）
make createsuperuser

# 4. 前端
cd frontend && bun install && cd ..
make dev
```

LINE 登入需要公開 HTTPS callback，沒設 tunnel 時 `http://localhost:5173` 登不進去。要驗證登入，請照下方
「LINE 登入本地測試」，用 **tunnel 網址**（不是 `localhost:5173`）開前端 → 用 LINE 登入 → header 應顯示
登入者名稱。這代表前後端串接成功（前端打的是真後端 `/auth/*`）。

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
  `AuthAdapter`（login/logout/me），對接後端 `apps/accounts`：登入後 token 放在
  HttpOnly cookie（JS 讀不到），前端請求對 API origin 帶 `credentials: "include"`，
  寫入請求另帶 `X-CSRFToken`（`GET /auth/csrf` 取得）。`main.tsx` 啟動時
  `setAuthAdapter(djangoAuthAdapter)`。
  - **角色（RBAC）怎麼流到前端**：後端角色 = Django Group（`backend/apps/accounts/roles.py`）——
    每個啟用中的使用者都有 `user`、`is_superuser` 隱含 `admin`，其餘是名稱在 `Role` 內的 group。
    `GET /auth/me` 回 `roles`（例如 `["admin", "user"]`）→ `django-adapter.ts` 的 `toUser()` 原樣放進
    `User.roles`（`id` 數字轉字串）→ 前端 `<RequireRole>` / `usePermission()` 直接可用。
  - 給某個 LINE 登入的使用者 admin 角色：`/admin/` → Users → 該使用者 → Groups 加 `admin`
    （這個異動會留在 AuditLog）。前端要重新登入或重新整理（重打 `/auth/me`）才會看到新角色。
  - 新增角色：後端 `Role` 加成員 + 建 group 的 data migration（照抄
    `accounts/migrations/0003_create_role_groups.py`）、前端 `shared/auth` 的 `Role` 型別同步加上，
    再 `make gen-api`——兩邊不一致時 `tsc` 會在 `django-adapter.ts` 報錯。
  - 前端的角色判斷只是藏 UI；真正的門檻是後端端點的 `auth=require_role(Role.X)`（缺角色回 403
    `permission_denied`）。
- **CORS**：後端 dev 預設允許 `localhost:5173/3000`；改前端 port 時要同步改
  後端 `.env.local` 的 `CORS_ALLOWED_ORIGINS`。
- **API 文件**：http://localhost:8000/api/docs（Swagger UI，`DEBUG=True` 才開；tunnel 模式下也可用 tunnel 網址
  加 `/api/docs` 開，`/openapi.json` 已在 Vite proxy 清單內）。需要登入的端點**不能直接試打**：cookie 認證的寫入
  請求必須帶 `X-CSRFToken`，而 Swagger UI 只在全域 auth 開 csrf 時才會自動帶（本專案的 auth 是各 router 自己掛的），
  所以會回 403 `csrf_failed`；LINE 登入的 cookie 也是種在 tunnel 網域，不在 `localhost:8000`。本專案沒有簽發
  Bearer token 的端點，開發時請用 shell 簽一顆，貼到 Swagger 右上角「Authorize」：
  ```bash
  make -C backend shell   # 進到 Django shell 後貼上下面三行
  ```
  ```python
  from django.contrib.auth import get_user_model
  from apps.accounts.services import AuthService
  print(AuthService.issue_token(get_user_model().objects.get(username="<你的帳號>")))
  ```
  有 `Authorization: Bearer` header 時後端只認 header、忽略 cookie，也不驗 CSRF，之後就能試打讀寫端點。
  這顆 token 等同登入憑證，只在本機開發用，別貼進文件、issue 或 log。

- **長任務**：後端 `apps/jobs` ↔ 前端 `useJobPolling(jobId)`（`@/shared/api`）。發起端點回 201 + job，
  前端輪詢 `GET /jobs/{id}` 拿 `{id, status, progress, result, error}`，取消打 `POST /jobs/{id}/cancel`。
  別人的 job 一律 404。試玩：`POST /jobs/demo`（Swagger）；前端 demo 頁的 job 區塊用的是假後端，不需要後端。
- **檔案下載**：`GET /articles/export?format=xlsx|pdf|zip` 直接回檔案（不包 `BaseResponse`）；前端用
  `apiDownload()` + `downloadBlob()`。跨網域讀檔名需要 `Content-Disposition` 被 CORS expose，後端已設。
- **SSE**：前端有 `useEventStream`，但後端**目前沒有** SSE 與 stream token 端點；demo 頁的 SSE 區塊預設不連線。
- **LINE 推播 vs LINE Login**：兩個不同的 channel。推播走 Messaging API（`LINE_MESSAGING_*`，
  `apps/notifications`），本地沒設 token 時只寫 log、不會真的送出。要推給 LINE 登入的使用者用
  `NotificationService.enqueue_line_to_user(user, "...")`（從 `LineProfile` 取 userId），前提是 Login 與
  Messaging 兩個 channel 在 LINE Developers Console 的**同一個 provider** 底下、使用者已加官方帳號好友。
  本地請用測試 channel，**不要拿正式 channel 的 token 測**。

### 新增一條「後端 endpoint + 前端呼叫」

1. 後端：照 [backend/CLAUDE.md](../backend/CLAUDE.md) 的分層加
   endpoint（或用 backend 的 `scaffold-app` / `add-resource` skill）。
2. 前端：在 page 的 `api/` segment 用 `@/shared/api` 的
   `apiGet/apiPost/...` 包 TanStack Query hook（已自動帶 cookie 與 CSRF token、
   401 自動清 session；或用 frontend 的 `scaffold-page` skill）。

## LINE 登入本地測試（cloudflared quick tunnel）

LINE Login 的 callback 需要公開 HTTPS URL，本機的 `localhost` 無法直接註冊到
LINE Developers Console。登入 token 放在 HttpOnly cookie，前端與 API 必須**同 site**
cookie 才送得出去，所以 tunnel 接的是 **Vite dev server（5173）**，不是後端：
`frontend/vite.config.ts` 的 `server.proxy` 會把 `/accounts`、`/auth`、`/articles`、
`/notifications`、`/jobs`、`/health`、`/api`、`/openapi.json` 轉給 `http://localhost:8000`，瀏覽器看到的
前端與 API 都是同一個 `https://<random>.trycloudflare.com`。

1. 啟動後端：`make up`
2. 啟動 tunnel（另開一個 terminal）：
   ```bash
   cloudflared tunnel --url http://localhost:5173
   ```
   輸出會有一行 `https://<random>.trycloudflare.com` —— 這就是這次測試要用的網址。
3. 更新 `backend/.env.local`（把 `<random>` 換成實際值）：
   ```
   ALLOWED_HOSTS=localhost,127.0.0.1,0.0.0.0,host.docker.internal,<random>.trycloudflare.com
   FRONTEND_BASE_URL=https://<random>.trycloudflare.com
   CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,https://<random>.trycloudflare.com
   ```
   - `ALLOWED_HOSTS` 要加上 tunnel hostname
   - `FRONTEND_BASE_URL` 是登入完成後導回前端的位置
   - `CORS_ALLOWED_ORIGINS` 要保留原本的 localhost 兩項再加上 tunnel origin
     （同時會進 CSRF 信任清單，不用另外設 `CSRF_TRUSTED_ORIGINS`）
   - 重啟後端讓設定生效：`make down && make up`
4. 到 [LINE Developers Console](https://developers.line.biz/console/) 的對應 Channel，
   把 Callback URL 設為 `https://<random>.trycloudflare.com/accounts/line/login/callback/`
5. 更新前端 `frontend/.env.development.local`（沒有就新建）：
   ```
   VITE_API_BASE_URL=
   ```
   留空 = 以目前頁面同源為 API origin，請求才會經過 Vite proxy。
   **務必是 `.env.development.local`，不是 `.env.local`** —— Vite 的 mode 專屬檔
   優先權高於通用檔，寫在 `.env.local` 會被 `.env.development` 的
   `http://localhost:8000` 蓋掉，前端仍會直連本機後端（跨 site，cookie 送不出去）。
6. 啟動前端：`make dev`，**用 tunnel 網址**開 `https://<random>.trycloudflare.com/login`
   （不是 `localhost:5173`），點「使用 LINE 登入」。
   若 dev server 本來就開著，**必須重啟** —— Vite 只在啟動時讀 env 檔。
   驗證 proxy 有通（回 `200`）：
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://<random>.trycloudflare.com/health/live
   ```

**注意**：proxy 刻意不改 `Host`、也不加 `X-Forwarded-*`，讓 Django 看到 tunnel 的 Host 與
cloudflared 帶來的 `X-Forwarded-Proto: https`。`backend/config/settings/local.py` 已設定信任這個
標頭（見該檔案註解），allauth 才會產生 `https://` 的 `redirect_uri`；沒有的話 LINE 會回
`400 Invalid redirect_uri value`。這是 dev-only 設定，正式環境走 `prod.py` 各自的等效機制。

**注意**：local 設定的 cookie 名稱是 `auth`、`Secure=False`（Safari 不收 `http://localhost` 的
Secure cookie），經 https tunnel 同源使用沒有問題；正式環境才是 `__Host-auth`。

**注意**：Vite 不 proxy Django 的 `/admin/`（前端有自己的 `/admin` 路由）；要進 Django admin 請直連
`http://localhost:8000/admin/`。

**注意**：quick tunnel 每次啟動網址都會變。每次重新測試都要重複步驟 2-4
（更新 `backend/.env.local` 的 `ALLOWED_HOSTS` / `FRONTEND_BASE_URL` / `CORS_ALLOWED_ORIGINS`、
LINE Console 的 Callback URL）；前端 `.env.development.local` 只需設一次。
若要固定網址（省去每次更新的麻煩），改用 cloudflared 的具名 tunnel（需要一個
掛到 Cloudflare 的網域）：`cloudflared tunnel login && cloudflared tunnel create <name>`，
之後網址固定，只需設定一次。具名 tunnel 的 hostname 不在 `.trycloudflare.com` 底下，要把它加進
`frontend/vite.config.ts` 的 `server.allowedHosts`，否則 Vite 會回 403 `Blocked request`。

測完請把 `backend/.env.local` 的上述三項與前端 `.env.development.local` 還原；日常開發
（`localhost:5173` → `localhost:8000` 直連）完全不經過 proxy，不受影響。

## 疑難排解

| 症狀 | 原因 / 處理 |
| --- | --- |
| `make up` 失敗：cannot connect to Docker daemon | Docker 未啟動：`colima start` |
| port 8000 / 5173 被占用 | `lsof -i :8000` 找出佔用程序；或改 port（前端改 port 記得同步後端 CORS） |
| 登入時 browser console 出現 CORS 錯誤 | 後端沒起（`make logs`）；或前端不是跑在 5173/3000 |
| 登入回 429 | `POST /auth/line/exchange` 有 per-IP 節流，稍候再試 |
| 匯出下載的檔名變成 `download` | 前端讀不到 `Content-Disposition`：確認後端 `CORS_EXPOSE_HEADERS` 還在、請求真的打到後端 |
| `/auth/me` 的 `roles` 沒有 `admin` | 該帳號不在 `admin` group 也不是 superuser；加完要重新整理前端 |
| API 回 500：relation does not exist | 忘了 `make migrate` |
| 前端顯示已登出（token 失效） | 後端 `make down -v` / token 過期屬正常；重新登入即可 |
| `make check-backend` / `test-local` 資料庫連不上 | `backend/.env.local` 是給容器內用的（`db`/`redis` 主機名）；host 端跑測試請把 `DATABASE_URL` 改為 `postgresql://app:app@localhost:5433/app`（Redis 同理改 `localhost`），或刪掉 `.env.local` 後以 `DATABASE_URL="sqlite://:memory:" make -C backend test-local` 跑記憶體 SQLite（CI 即如此） |
