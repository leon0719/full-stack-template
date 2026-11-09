# CLAUDE.md

Monorepo 全端模板：`backend/`（Django Ninja + Celery，uv + Docker）＋
`frontend/`（Vite + React 19 + FSD，bun + Biome）。

## 回應語言

**一律使用繁體中文，採台灣本地化用語**——用 程式碼／資料／函式／物件／介面／型別／快取／預設／效能，
不用 代碼／數據／函數／對象／接口／類型／緩存／默認／性能。即使以英文提問，回應仍用繁體中文。
程式碼識別字、檔名、目錄名、套件名保持英文不翻譯。

## ⛔ 只能由人執行

不要自己執行——停下來，把完整指令交給使用者（`.claude/settings.json` 也會擋）：
- `make deploy-frontend`／`scripts/deploy-frontend.sh`、任何 `aws` 指令
- 任何碰 prod 的操作：`backend/docker/docker-compose.prod.yml`、`.env.prod`、連線到 prod DB／Redis
- `git push`（任何分支）、force-push、改寫已推送的歷史
- 呼叫真實的第三方 API（含真實 LINE Login）、寄出真實 email

**進到子目錄工作時，以該子目錄的 CLAUDE.md 為準**：

- 後端慣例（分層、settings、測試、Docker）→ [backend/CLAUDE.md](backend/CLAUDE.md)
- 前端慣例（FSD import 鐵律、TDD、平台原件）→ [frontend/CLAUDE.md](frontend/CLAUDE.md)

## 頂層指令

- `make up` / `make down` / `make logs` / `make migrate` — 後端 Docker
- `make dev` — 前端開發伺服器
- `make gen-api` — 後端 OpenAPI → `frontend/src/shared/api/schema.d.ts`（不需啟動後端）。**後端 schema／endpoint
  一改就跑並 commit 產物**，前端 `tsc` 會指出要跟著改的地方
- `make check` — 前後端全部品質檢查（= `check-backend` + `check-frontend`）
- `make deploy-frontend` — 前端部署到 S3 + CloudFront（見 docs/deployment.md）

## 整合層（本 repo 相對兩個上游模板的新增物）

- **Auth 串接**：登入只有 LINE Login，無帳密登入。後端用 django-allauth 的
  LINE provider（`SOCIALACCOUNT_ONLY=True`）處理與 LINE 的 OAuth 交換，自訂
  adapter（`backend/apps/accounts/adapters.py`）把登入結果換成既有的 opaque
  bearer token，存進一次性 exchange code（60 秒 TTL）後導回前端
  `/login/callback?code=...`。前端 `django-adapter.ts` 的 `completeLineLogin(code)`
  打 `POST /auth/line/exchange` 換 token，再沿用兩段式流程打 `GET /auth/me`。
  `main.tsx` 啟動時 `setAuthAdapter(djangoAuthAdapter)`。後端無角色概念 →
  adapter 固定 `roles: ["user"]`（RBAC 擴充點）。本地測試 LINE callback 需要
  公開 HTTPS，見 `docs/development.md` 的 cloudflared 章節。
- **dev 串接**：前端 `.env.development` 設 `VITE_API_BASE_URL=http://localhost:8000`
  跨源直連；後端 CORS dev 預設允許 5173，改 port 要同步。
- **CI**：`.github/workflows/{backend,frontend}-ci.yml`，`paths` filter 各管各的；
  子目錄不放 workflow。
- **文件**：`docs/development.md`（開發）、`docs/deployment.md`（部署）。
  後端部署細節在 `backend/docs/`，頂層文件只寫整合層、不重複。

## 前後端契約

- 回應一律 `BaseResponse`：成功 `{"data": <T>, "error": null}`，失敗
  `{"data": null, "error": {"code": <HTTP 狀態碼>, "message", "reason"}}`。細節：後端
  `backend/CLAUDE.md`「Responses / Errors」、前端 `frontend/CLAUDE.md`「API client」。
- 前端 `shared/api` client 自動解包 `data`；錯誤分支看 `ApiError.reason`（後端 `config/errors.py` 的
  `ErrorCode`），不比對 `message`。
- 前端型別一律來自 `make gen-api` 產生的 `schema.d.ts`，不手寫後端型別。

## 修改守則

- 不重組兩個子模板的內部結構；整合物放頂層或各自模板的既有擴充點
  （adapter、env、compose）。
- 後端 API 變更會影響 `django-adapter.ts` 的對接（schema 見
  `backend/apps/accounts/schema.py`）——改 auth 相關 endpoint 時兩邊一起看，並跑 `make gen-api`。

## Git

- Commit 格式 `<type>: <中文說明>`，type 只有 `feat`／`fix`／`docs`／`style`／`refactor`／`test`／`chore`。
  **說明用中文**、**不使用 scope**（不寫 `feat(frontend):`；前後端一起改就寫在說明裡）。
- 破壞性變更（呼叫端不改程式就會壞）在 type 後加 `!`：`feat!: /auth/me 移除 email 欄位`。
- 分支 `<類型>/<描述>`，類型只有 `feat`／`fix`／`refactor`／`docs`／`chore`；不直接 commit 到 `main`。
