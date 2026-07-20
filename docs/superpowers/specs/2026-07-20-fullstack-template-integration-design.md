# 全端專案模板整合設計

日期：2026-07-20
狀態：已與使用者確認方向，待實作計畫

## 目標

將兩個既有模板整合為一個開箱即用的全端專案模板：

- 後端：`../django-ninja-project-tree` — Django Ninja + Celery + PostgreSQL + Redis，uv 管理，Docker 開發環境
- 前端：`../frontend` — Vite + React 19 + TypeScript，FSD v2.1 pages-first，bun + Biome

驗收標準：`make up`（後端 Docker）+ `bun run dev`（前端本機）後，可用真後端完成
register → login → `/auth/me` 顯示登入者 → logout 的完整流程；前後端各自的
check（ruff/mypy/pytest、biome/tsc/vitest）全綠；頂層 CI 兩個 job 可跑。

## 已確認的決策

| 議題 | 決定 |
|------|------|
| 整合結構 | Monorepo 子目錄（`backend/` + `frontend/`），各自完整複製，頂層加整合層 |
| 前後端串接 | 實作真實 `djangoAuthAdapter` 呼叫後端 `/auth/*`，開箱即可登入 |
| 開發模式 | 前端本機 `bun run dev` + Vite proxy，後端 Docker `make up` |
| Prod 前端 | S3 + CloudFront；模板附部署腳本 + 文件（不含 IaC） |
| Prod 後端 | 沿用既有 `docker-compose.prod.yml`，不動 |
| 文件 | 「怎麼開發」與「怎麼部署」必須寫清楚（使用者明確要求，見文件章節） |

## 1. 目錄結構

```
full-stack-template/
├── backend/                    # django-ninja-project-tree 完整複製（去除 .git）
├── frontend/                   # frontend 模板完整複製（去除 .git）
├── Makefile                    # 頂層統一入口，委派到 backend/frontend
├── .github/workflows/ci.yml    # 頂層 CI，paths filter 分別跑前後端 job
├── scripts/deploy-frontend.sh  # S3 + CloudFront 部署腳本
├── docs/
│   ├── development.md          # 開發指南（詳見「文件」章節）
│   └── deployment.md           # 部署指南（詳見「文件」章節）
├── CLAUDE.md                   # 頂層導覽：指向 backend/CLAUDE.md 與 frontend/CLAUDE.md
├── README.md                   # 快速上手 + 指向兩份指南
└── .gitignore                  # 頂層（合併兩邊的頂層忽略項）
```

- 兩個模板**原封搬入**：各自的工具鏈（uv/bun）、Makefile、`.claude/` skills、
  docs、`.env` example 都保留，內部不重組。
- 兩邊原有的 `.github/workflows/ci.yml` 移除，改由頂層 CI 統一管理：
  用 `paths:` filter 分別觸發 backend job（ruff format check、lint、mypy、
  pytest、prod Docker build）與 frontend job（lint:ci、lint:fsd、type-check、
  test、build），步驟內容沿用原 workflow，僅補上 `working-directory`。
- 兩邊的 `.git` 目錄不複製；整合後的模板自成一個新 git repo。

### 頂層 Makefile

| 指令 | 行為 |
|------|------|
| `make up` / `make down` | 委派 `backend/`：起停後端 Docker（API、DB、Redis、Celery） |
| `make dev` | 委派 `frontend/`：`bun run dev` |
| `make check` | 兩邊 lint + type-check + test 全跑 |
| `make check-backend` / `make check-frontend` | 各自的品質檢查 |
| `make deploy-frontend` | 呼叫 `scripts/deploy-frontend.sh` |

## 2. 前後端串接（真實 Auth）

- 前端 `shared/auth` 新增 `djangoAuthAdapter`：實作既有 `AuthAdapter` 介面
  （`login/logout/me`），呼叫後端 `POST /auth/login`、`POST /auth/logout`、
  `GET /auth/me`。token 持久化沿用 adapter 職責設計（login 時 persist、
  logout 時 clear、me 從持久化 token 還原 session）。
- app 啟動處呼叫 `setAuthAdapter(djangoAuthAdapter)`；dev/prod 都用真後端。
  `fakeAuthAdapter` 保留供單元測試使用。
- 欄位對齊：前端登入表單欄位對齊後端 login schema。後端 accounts 沒有 role
  概念，adapter 先給固定 `["user"]` 角色，文件註明 RBAC 需自行擴充。
- 開發方式：TDD——adapter 先寫 Vitest + mock fetch 的失敗測試再實作。

## 3. 開發流程（dev）

- 後端：`make up`，API 在 `http://localhost:8000`。
- 前端：本機 `bun run dev`；`vite.config.ts` 加 dev proxy 將 API 路徑轉發到
  `http://localhost:8000`，前端以同源相對路徑呼叫 API，**開發時不需 CORS**。
- `.env.example` 給好可直接跑的預設值。
- 後端不預裝 `django-cors-headers`；若要跨網域直連（含 prod），依部署文件
  步驟加裝設定。

## 4. Prod 部署

- 後端：沿用 `backend/docker/docker-compose.prod.yml`，TLS 由前面的
  reverse proxy 終結，維持原模板設計，不動。
- 前端：S3 + CloudFront。
  - `scripts/deploy-frontend.sh`：`bun run build` →
    `aws s3 sync dist/`（`assets/*` 長快取 immutable、`index.html` no-cache）→
    `aws cloudfront create-invalidation`。
  - Bucket 名稱、Distribution ID、`VITE_API_BASE_URL` 由環境變數提供，
    腳本開頭檢查缺漏並給出清楚錯誤訊息。
  - Prod 前後端不同源：後端需開 CORS（部署文件寫明安裝
    `django-cors-headers` 與設定步驟）。

## 5. 文件（使用者明確要求：開發與部署要寫清楚）

兩份指南是本次整合的一級交付物，不是附註。

### `docs/development.md` — 開發指南

- 前置需求：Docker（colima）、uv、bun 的安裝與版本。
- 首次啟動：clone → 後端 `.env.local` 設定 → `make up` → 前端 `bun install` →
  `bun run dev` → 開瀏覽器登入驗證，逐步指令可直接複製貼上。
- 日常開發：前後端各自的常用指令對照表（migrate、test、lint、logs…）、
  頂層 Makefile 對照。
- 串接說明：Vite proxy 如何運作、`VITE_API_BASE_URL` 何時需要設、
  auth adapter 在哪裡、如何加新的 API 呼叫（前端 `shared/api` +
  後端 add-resource 流程各指向子模板文件）。
- 疑難排解：port 衝突、Docker 未啟動、migration 未跑等常見狀況。

### `docs/deployment.md` — 部署指南

- 架構總覽圖：CloudFront + S3（前端）/ reverse proxy + Docker（後端）。
- 後端部署：`.env.prod` 必填項、`docker-compose.prod.yml` 啟動步驟、
  reverse proxy 需設定的項目（`FORWARDED_ALLOW_IPS`、`CSRF_TRUSTED_ORIGINS`）。
- 前端部署：
  - AWS 一次性設定：S3 bucket（不開公開存取）、CloudFront distribution +
    OAC、SPA fallback（403/404 → `/index.html`）、自訂網域與憑證要點。
  - 每次部署：需要的環境變數、執行 `make deploy-frontend`、驗證步驟。
- CORS 設定：prod 前後端不同源時，後端加 `django-cors-headers` 的完整步驟。
- 檢核清單：上線前逐項確認（env vars、migrate、CORS、cache 行為）。

## 6. 測試與驗收

- 前端 adapter：Vitest 單元測試（mock fetch），覆蓋 login 成功/失敗、
  me 還原 session、logout 清除。
- 後端：原有 pytest 全數保留且通過。
- 端對端手動驗收：register → login → me → logout 完整流程可跑通。
- CI：頂層 workflow 前後端兩個 job 均綠。

## 不做的事（YAGNI）

- 不做 Terraform / IaC。
- 不做前端 Docker prod image（prod 走 S3 + CloudFront）。
- 不做後端 RBAC 擴充（僅文件註明擴充點）。
- 不做 articles CRUD 的前端示範頁面（僅 auth 串接）。
- 不改動兩個子模板的內部架構與慣例。
