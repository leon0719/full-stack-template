# CLAUDE.md

Monorepo 全端模板：`backend/`（Django Ninja + Celery，uv + Docker）＋
`frontend/`（Vite + React 19 + FSD，bun + Biome）。

**進到子目錄工作時，以該子目錄的 CLAUDE.md 為準**：

- 後端慣例（分層、settings、測試、Docker）→ [backend/CLAUDE.md](backend/CLAUDE.md)
- 前端慣例（FSD import 鐵律、TDD、平台原件）→ [frontend/CLAUDE.md](frontend/CLAUDE.md)

## 頂層指令

- `make up` / `make down` / `make logs` / `make migrate` — 後端 Docker
- `make dev` — 前端開發伺服器
- `make check` — 前後端全部品質檢查（= `check-backend` + `check-frontend`）
- `make deploy-frontend` — 前端部署到 S3 + CloudFront（見 docs/deployment.md）

## 整合層（本 repo 相對兩個上游模板的新增物）

- **Auth 串接**：`frontend/src/shared/auth/adapter/django-adapter.ts` 實作
  `AuthAdapter` 直連後端 `/auth/*`（login 兩段式：POST /auth/login 取 token →
  GET /auth/me 取 user）；`main.tsx` 啟動時 `setAuthAdapter(djangoAuthAdapter)`。
  後端無角色概念 → adapter 固定 `roles: ["user"]`（RBAC 擴充點）。
- **dev 串接**：前端 `.env.development` 設 `VITE_API_BASE_URL=http://localhost:8000`
  跨源直連；後端 CORS dev 預設允許 5173，改 port 要同步。
- **CI**：`.github/workflows/{backend,frontend}-ci.yml`，`paths` filter 各管各的；
  子目錄不放 workflow。
- **文件**：`docs/development.md`（開發）、`docs/deployment.md`（部署）。
  後端部署細節在 `backend/docs/`，頂層文件只寫整合層、不重複。

## 修改守則

- 不重組兩個子模板的內部結構；整合物放頂層或各自模板的既有擴充點
  （adapter、env、compose）。
- 後端 API 變更會影響 `django-adapter.ts` 的對接（schema 見
  `backend/apps/accounts/schema.py`）——改 auth 相關 endpoint 時兩邊一起看。
