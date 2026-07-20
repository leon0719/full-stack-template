# 全端專案模板整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 `../django-ninja-project-tree`（後端）與 `../frontend`（前端）整合為單一 monorepo 全端模板，含真實 auth 串接、統一 Makefile/CI、S3+CloudFront 部署腳本與整合層文件。

**Architecture:** Monorepo 子目錄（`backend/` + `frontend/`）原封搬入兩模板；前端以 `djangoAuthAdapter` 直連後端 `/auth/*`（dev 跨源，後端 CORS dev 預設已允許 5173）；prod 後端走內建 Cloudflare Tunnel、前端走 S3 + CloudFront。

**Tech Stack:** Django Ninja / Celery / PostgreSQL / Redis / uv / Docker；Vite / React 19 / TypeScript / FSD / bun / Biome / Vitest；GitHub Actions；AWS CLI（s3 sync + cloudfront invalidation）。

**Spec:** `docs/superpowers/specs/2026-07-20-fullstack-template-integration-design.md`

## Global Constraints

- 工作目錄（repo root）：`/Users/riversoft/Desktop/workSpace/side-project/full-stack-template`
- 來源模板：`/Users/riversoft/Desktop/workSpace/side-project/django-ninja-project-tree`、`/Users/riversoft/Desktop/workSpace/side-project/frontend`（**唯讀，不可修改來源 repo**）
- 兩子模板內部架構與慣例**不可重組**；只做整合層新增與最小必要修改
- 前端規範：Biome（indentWidth 2、lineWidth 100、double quotes）、FSD import 鐵律（跨 slice 走 index.ts public API）、TDD（RED→GREEN→REFACTOR）
- 後端規範：不動任何後端程式碼（本計畫後端零修改）
- 文件一律繁體中文；後端細節不重寫、連結到 `backend/docs/*`
- 每個 task 結尾 commit；commit message 用 conventional commits
- YAGNI：不做 IaC、不做前端 prod Docker image、不做 RBAC、不做 articles 前端頁面、不做 register 前端頁面（register 走 `/api/docs` 或 curl）

---

### Task 1: 搬入兩個模板

**Files:**
- Create: `backend/`（整個 django-ninja-project-tree 的 git-tracked 檔案）
- Create: `frontend/`（整個 frontend 模板的 git-tracked 檔案）
- Create: `.gitignore`（頂層）
- Delete（搬入後）: `backend/.github/`、`frontend/.github/`（CI 移到頂層，Task 3 重建）

**Interfaces:**
- Produces: 後續所有 task 依賴的 `backend/`、`frontend/` 目錄；`backend/Makefile` 的 targets（`up/down/logs/migrate/all/test-local/prod-*`）；`frontend/package.json` scripts（`dev/build/lint/lint:ci/lint:fsd/type-check/test`）

- [ ] **Step 1: 用 git archive 複製兩模板的 tracked 檔案**

`git archive` 只帶 tracked 檔案——自動排除 `.git`、`.venv`、`node_modules`、`dist`、快取與 `.env.local` 等機密。

```bash
cd /Users/riversoft/Desktop/workSpace/side-project/full-stack-template
mkdir -p backend frontend
git -C ../django-ninja-project-tree archive HEAD | tar -x -C backend
git -C ../frontend archive HEAD | tar -x -C frontend
```

- [ ] **Step 2: 移除子模板的 .github（頂層 CI 於 Task 3 重建）**

```bash
rm -rf backend/.github frontend/.github
```

- [ ] **Step 3: 建立頂層 .gitignore**

子目錄各自的 `.gitignore` 已隨檔案搬入且對其子樹生效，頂層只需補通用項：

```gitignore
.DS_Store
*.log
```

- [ ] **Step 4: 驗證搬入結果**

```bash
test -f backend/manage.py && test -f backend/Makefile && test -f frontend/package.json && test -f frontend/vite.config.ts && echo OK
test ! -d backend/.git && test ! -d frontend/.git && test ! -d backend/.github && echo CLEAN
```

Expected: 輸出 `OK` 與 `CLEAN`。

- [ ] **Step 5: 後端可啟動 smoke check**

```bash
cd backend && make up && sleep 15 && curl -fsS http://localhost:8000/health/live && cd ..
```

Expected: 回傳 liveness JSON（HTTP 200）。若失敗看 `cd backend && make logs-api`。

- [ ] **Step 6: 前端測試可跑**

```bash
cd frontend && bun install && bun run test && cd ..
```

Expected: Vitest 全數通過。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: vendor backend (django-ninja-project-tree) and frontend templates into monorepo"
```

---

### Task 2: 頂層 Makefile

**Files:**
- Create: `Makefile`

**Interfaces:**
- Consumes: `backend/Makefile` 的 `up/down/logs/migrate/createsuperuser/all/test-local`；`frontend/package.json` scripts
- Produces: 頂層指令 `make up/down/logs/migrate/dev/check/check-backend/check-frontend/deploy-frontend`（`deploy-frontend` 呼叫的 `scripts/deploy-frontend.sh` 於 Task 5 建立）

- [ ] **Step 1: 建立 Makefile**

```makefile
.PHONY: help up down logs migrate createsuperuser dev check check-backend check-frontend deploy-frontend

help:
	@echo "=========================================="
	@echo "  Full-Stack Template (backend + frontend)"
	@echo "=========================================="
	@echo ""
	@echo "開發:"
	@echo "  make up              - 啟動後端 Docker (API/DB/Redis/Celery)"
	@echo "  make down            - 停止後端 Docker"
	@echo "  make logs            - 後端服務日誌"
	@echo "  make migrate         - 執行資料庫遷移"
	@echo "  make createsuperuser - 建立後端管理員帳號"
	@echo "  make dev             - 啟動前端開發伺服器 (bun run dev)"
	@echo ""
	@echo "品質檢查:"
	@echo "  make check           - 前後端全部檢查"
	@echo "  make check-backend   - 後端 format+lint+mypy+test"
	@echo "  make check-frontend  - 前端 biome+fsd+tsc+vitest"
	@echo ""
	@echo "部署:"
	@echo "  make deploy-frontend - 前端 build 並部署到 S3 + CloudFront"
	@echo ""
	@echo "子專案細部指令: make -C backend help / frontend 見 frontend/CLAUDE.md"

up:
	$(MAKE) -C backend up

down:
	$(MAKE) -C backend down

logs:
	$(MAKE) -C backend logs

migrate:
	$(MAKE) -C backend migrate

createsuperuser:
	$(MAKE) -C backend createsuperuser

dev:
	cd frontend && bun run dev

check-backend:
	$(MAKE) -C backend all
	$(MAKE) -C backend test-local

check-frontend:
	cd frontend && bun run lint && bun run lint:fsd && bun run type-check && bun run test

check: check-backend check-frontend

deploy-frontend:
	./scripts/deploy-frontend.sh
```

- [ ] **Step 2: 驗證委派**

```bash
make help
make check-frontend
```

Expected: help 顯示上表；`check-frontend` 全綠（後端 `check-backend` 需要 uv 環境，此步可另跑 `make check-backend` 驗證，若本機 `.venv` 未建先 `cd backend && make install`）。

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "feat: add top-level Makefile delegating to backend/frontend"
```

---

### Task 3: 頂層 CI 與 dependabot

**Files:**
- Create: `.github/workflows/backend-ci.yml`
- Create: `.github/workflows/frontend-ci.yml`
- Create: `.github/dependabot.yml`

**Interfaces:**
- Consumes: Task 1 的 `backend/`、`frontend/` 目錄結構
- Produces: push/PR 時依 `paths` filter 分別觸發的兩條 CI

- [ ] **Step 1: 建立 backend-ci.yml**

內容承襲原後端 `ci.yml`（quality / tests-postgres / audit / docker 四個 job），差異：加 `paths` filter、`defaults.run.working-directory: backend`、docker build 的 context/file 改指 `backend/`。

```yaml
name: Backend CI

on:
  push:
    branches: [main]
    paths: ["backend/**", ".github/workflows/backend-ci.yml"]
  pull_request:
    paths: ["backend/**", ".github/workflows/backend-ci.yml"]

permissions:
  contents: read

concurrency:
  group: backend-ci-${{ github.ref }}
  cancel-in-progress: true

defaults:
  run:
    working-directory: backend

jobs:
  quality:
    runs-on: ubuntu-latest
    env:
      SECRET_KEY: ci-insecure-key
      DATABASE_URL: "sqlite://:memory:"
    steps:
      - uses: actions/checkout@v5

      - uses: astral-sh/setup-uv@v6
        with:
          enable-cache: true
          cache-dependency-glob: "backend/uv.lock"

      - name: Install dependencies
        run: uv sync --frozen

      - name: Format check
        run: uv run ruff format --check .

      - name: Lint
        run: uv run ruff check .

      - name: Type check
        run: uv run mypy .

      - name: Migrations are up to date
        run: uv run python manage.py makemigrations --check --dry-run

      - name: Deployment checks (check --deploy)
        env:
          ENV: prod
          DJANGO_SETTINGS_MODULE: config.settings.prod
          SECRET_KEY: "ci-deploy-check-only-not-a-real-secret-key-0123456789ABCDEF"
          DATABASE_URL: "sqlite://:memory:"
          ALLOWED_HOSTS: "example.com"
          CORS_ALLOWED_ORIGINS: "https://app.example.com"
          CSRF_TRUSTED_ORIGINS: "https://app.example.com"
          CELERY_BROKER_URL: "redis://ci-broker:6379/0"
          CACHE_URL: "redis://ci-cache:6379/1"
        run: uv run python manage.py check --deploy --fail-level WARNING

      - name: Tests
        run: uv run pytest --cov=apps --cov=config --cov-report=term-missing --cov-fail-under=70

  tests-postgres:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18@sha256:4aabea78cf39b90e834caf3af7d602a18565f6fe2508705c8d01aa63245c2e20
        env:
          POSTGRES_USER: app
          POSTGRES_PASSWORD: app
          POSTGRES_DB: app
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U app -d app"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      SECRET_KEY: ci-insecure-key
      DATABASE_URL: "postgresql://app:app@localhost:5432/app"
    steps:
      - uses: actions/checkout@v5

      - uses: astral-sh/setup-uv@v6
        with:
          enable-cache: true
          cache-dependency-glob: "backend/uv.lock"

      - name: Install dependencies
        run: uv sync --frozen

      - name: Tests (Postgres)
        run: uv run pytest

  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: astral-sh/setup-uv@v6
        with:
          enable-cache: true
          cache-dependency-glob: "backend/uv.lock"

      - name: Export locked requirements
        run: uv export --frozen --no-dev --no-emit-project --format requirements-txt -o requirements-audit.txt

      - name: pip-audit
        run: uvx pip-audit --disable-pip -r requirements-audit.txt

  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: docker/setup-buildx-action@v3

      - name: Build prod image
        uses: docker/build-push-action@v6
        with:
          context: ./backend
          file: backend/docker/Dockerfile
          tags: app:ci
          push: false
          load: true
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Trivy image scan
        uses: aquasecurity/trivy-action@0.28.0
        with:
          image-ref: app:ci
          format: table
          severity: CRITICAL
          exit-code: "1"
          ignore-unfixed: true

      - name: Smoke test /health/live
        working-directory: .
        run: |
          docker run -d --name smoke -p 8000:8000 \
            -e ENV=prod \
            -e DJANGO_SETTINGS_MODULE=config.settings.prod \
            -e SECRET_KEY="ci-deploy-check-only-not-a-real-secret-key-0123456789ABCDEF" \
            -e DATABASE_URL="sqlite://:memory:" \
            -e ALLOWED_HOSTS="localhost,127.0.0.1" \
            -e CORS_ALLOWED_ORIGINS="https://smoke.example.com" \
            -e CELERY_BROKER_URL="redis://smoke-broker:6379/0" \
            -e CACHE_URL="redis://smoke-cache:6379/1" \
            -e UVICORN_HOST=0.0.0.0 \
            -e WEB_CONCURRENCY=1 \
            app:ci
          for i in $(seq 1 30); do
            if curl -fsS http://localhost:8000/health/live; then
              echo "smoke test passed"
              exit 0
            fi
            sleep 2
          done
          echo "smoke test FAILED — container logs:"
          docker logs smoke
          exit 1

      - name: Dump container logs on failure
        if: failure()
        working-directory: .
        run: docker logs smoke || true

      - name: Cleanup
        if: always()
        working-directory: .
        run: docker rm -f smoke || true
```

（註：`docker` job 內的 `docker run` 步驟不依賴 backend 工作目錄，設 `working-directory: .` 避免 defaults 影響；uses 步驟不受 defaults 影響。）

- [ ] **Step 2: 建立 frontend-ci.yml**

```yaml
name: Frontend CI

on:
  push:
    branches: [main]
    paths: ["frontend/**", ".github/workflows/frontend-ci.yml"]
  pull_request:
    paths: ["frontend/**", ".github/workflows/frontend-ci.yml"]

permissions:
  contents: read

concurrency:
  group: frontend-ci-${{ github.ref }}
  cancel-in-progress: true

defaults:
  run:
    working-directory: frontend

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run lint:ci
      - run: bun run lint:fsd
      - run: bun run type-check
      - run: bun run test
      - run: bun run build
```

- [ ] **Step 3: 建立 .github/dependabot.yml**

承襲後端的 dependabot 設定，`directory` 改指到 monorepo 路徑：

```yaml
version: 2
updates:
  # 後端 Python 依賴（uv 讀 pyproject.toml + uv.lock）
  - package-ecosystem: "uv"
    directory: "/backend"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    groups:
      python-dependencies:
        patterns:
          - "*"

  # 頂層 .github/workflows/*.yml 用到的 Actions
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    groups:
      github-actions:
        patterns:
          - "*"

  # backend/docker/Dockerfile* 的 base image
  - package-ecosystem: "docker"
    directory: "/backend/docker"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10

  # backend/docker/docker-compose.*.yml 引用的 image（如 cloudflared）
  - package-ecosystem: "docker-compose"
    directory: "/backend/docker"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
```

- [ ] **Step 4: 驗證 YAML 語法**

```bash
python3 -c "import yaml,glob; [yaml.safe_load(open(f)) for f in glob.glob('.github/**/*.yml', recursive=True)]; print('YAML OK')"
```

Expected: `YAML OK`。

- [ ] **Step 5: Commit**

```bash
git add .github
git commit -m "ci: add path-filtered backend/frontend workflows and dependabot"
```

---

### Task 4: djangoAuthAdapter（真實 auth 串接）

**Files:**
- Test: `frontend/src/shared/auth/adapter/django-adapter.test.ts`
- Create: `frontend/src/shared/auth/adapter/django-adapter.ts`
- Modify: `frontend/src/shared/auth/index.ts`（export adapter）
- Modify: `frontend/src/main.tsx`（啟動時 `setAuthAdapter`）
- Create: `frontend/.env.development`（dev 預設 `VITE_API_BASE_URL`）
- Modify: `frontend/.gitignore`（放行 `.env.development`）
- Modify: `frontend/.env.example`（註明 dev 預設）

**Interfaces:**
- Consumes: `AuthAdapter`／`AuthSession`／`User`（`frontend/src/shared/auth/model/types.ts`：`login(credentials: Credentials): Promise<AuthSession>`、`logout(): Promise<void>`、`me(): Promise<AuthSession | null>`）；`tokenStorage`（`../lib/token-storage`：`get/set/clear`，key `auth.token`）；`env.apiBaseUrl`（`@/shared/config`）；後端 API：`POST /auth/login {username,password} → {token}`（錯誤 401）、`GET /auth/me → {id:number, username, email}`（Bearer）、`POST /auth/logout → {detail}`（Bearer）
- Produces: `djangoAuthAdapter: AuthAdapter`，自 `@/shared/auth` public API export

背景知識：
- 後端 login 只回 `{token}`，user 資料要再打 `/auth/me` — adapter 的 `login` 是兩段式。
- `shared/api/client.ts` 從 auth store 取 token，但 login/init 當下 store 還沒有 token，且 `client.ts` import `@/shared/auth` 會與 adapter 形成循環 import — 因此 **adapter 直接用 `fetch`**，不用 `shared/api` client。
- 後端 accounts 無角色概念，一律對映 `roles: ["user"]`（RBAC 擴充點，文件註明）。

- [ ] **Step 1: 寫失敗測試**

`frontend/src/shared/auth/adapter/django-adapter.test.ts`：

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenStorage } from "../lib/token-storage";
import { djangoAuthAdapter } from "./django-adapter";

const ME_PAYLOAD = { id: 7, username: "alice", email: "alice@example.com" };
const ALICE = { id: "7", name: "alice", roles: ["user"] };

type MockResponse = { status: number; json?: unknown };

function stubFetch(...responses: MockResponse[]) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce(
      new Response(r.json === undefined ? null : JSON.stringify(r.json), {
        status: r.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  tokenStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("djangoAuthAdapter.login", () => {
  it("exchanges credentials for a token then loads the user profile", async () => {
    const fetchMock = stubFetch({ status: 200, json: { token: "t-1" } }, { status: 200, json: ME_PAYLOAD });

    const session = await djangoAuthAdapter.login({ username: "alice", password: "pw12345678" });

    expect(session).toEqual({ user: ALICE, token: "t-1" });
    expect(tokenStorage.get()).toBe("t-1");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/auth/me", expect.anything());
  });

  it("throws on invalid credentials and does not persist a token", async () => {
    stubFetch({ status: 401, json: { detail: "Invalid credentials" } });

    await expect(
      djangoAuthAdapter.login({ username: "alice", password: "wrong" }),
    ).rejects.toThrow("Invalid credentials");
    expect(tokenStorage.get()).toBeNull();
  });
});

describe("djangoAuthAdapter.me", () => {
  it("returns null without calling the API when no token is persisted", async () => {
    const fetchMock = stubFetch();

    await expect(djangoAuthAdapter.me()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restores the session from a persisted token", async () => {
    tokenStorage.set("t-1");
    stubFetch({ status: 200, json: ME_PAYLOAD });

    await expect(djangoAuthAdapter.me()).resolves.toEqual({ user: ALICE, token: "t-1" });
  });

  it("clears a rejected token and returns null on 401", async () => {
    tokenStorage.set("t-expired");
    stubFetch({ status: 401, json: { detail: "Invalid token" } });

    await expect(djangoAuthAdapter.me()).resolves.toBeNull();
    expect(tokenStorage.get()).toBeNull();
  });
});

describe("djangoAuthAdapter.logout", () => {
  it("revokes the token server-side and clears local storage", async () => {
    tokenStorage.set("t-1");
    const fetchMock = stubFetch({ status: 200, json: { detail: "Logged out" } });

    await djangoAuthAdapter.logout();

    expect(tokenStorage.get()).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("clears local storage even when the revoke request fails", async () => {
    tokenStorage.set("t-1");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(djangoAuthAdapter.logout()).rejects.toThrow("network down");
    expect(tokenStorage.get()).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd frontend && bun run test src/shared/auth/adapter/django-adapter.test.ts`
Expected: FAIL — `Cannot find module './django-adapter'`（或同義的 resolve 錯誤）。

- [ ] **Step 3: 最小實作**

`frontend/src/shared/auth/adapter/django-adapter.ts`：

```typescript
import { env } from "@/shared/config";
import { tokenStorage } from "../lib/token-storage";
import type { AuthAdapter, User } from "../model/types";

interface MeResponse {
  id: number;
  username: string;
  email: string;
}

// 後端 accounts 尚無角色概念，固定給 "user"；接 RBAC 時在此對映後端的角色欄位。
function toUser(me: MeResponse): User {
  return { id: String(me.id), name: me.username, roles: ["user"] };
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const payload: unknown = await res.json();
    if (payload && typeof payload === "object" && "detail" in payload) {
      return String((payload as { detail: unknown }).detail);
    }
  } catch {
    // 非 JSON body,用 fallback
  }
  return fallback;
}

async function fetchMe(token: string): Promise<User | null> {
  const res = await fetch(`${env.apiBaseUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(await extractErrorMessage(res, `GET /auth/me failed with ${res.status}`));
  return toUser((await res.json()) as MeResponse);
}

// 串接 backend apps/accounts 的 opaque bearer token 認證:
// login 只回 {token},user 資料需再打 /auth/me,故 login 為兩段式。
export const djangoAuthAdapter: AuthAdapter = {
  async login(credentials) {
    const res = await fetch(`${env.apiBaseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    if (!res.ok) {
      throw new Error(await extractErrorMessage(res, `POST /auth/login failed with ${res.status}`));
    }
    const { token } = (await res.json()) as { token: string };
    const user = await fetchMe(token);
    if (!user) throw new Error("Login succeeded but the issued token was rejected");
    tokenStorage.set(token);
    return { user, token };
  },

  async logout() {
    const token = tokenStorage.get();
    try {
      if (token) {
        await fetch(`${env.apiBaseUrl}/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } finally {
      // 就算 server 端撤銷失敗也要清本地 session,避免卡在登不出的狀態
      tokenStorage.clear();
    }
  },

  async me() {
    const token = tokenStorage.get();
    if (!token) return null;
    const user = await fetchMe(token);
    if (!user) {
      tokenStorage.clear();
      return null;
    }
    return { user, token };
  },
};
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd frontend && bun run test src/shared/auth/adapter/django-adapter.test.ts`
Expected: PASS（7 tests）。

- [ ] **Step 5: 加入 public API export**

`frontend/src/shared/auth/index.ts` 第 1 行後加：

```typescript
export { djangoAuthAdapter } from "./adapter/django-adapter";
```

- [ ] **Step 6: 啟動時掛上 adapter**

`frontend/src/main.tsx`——在 `installGlobalErrorReporting();` 之後加：

```typescript
import { djangoAuthAdapter, setAuthAdapter } from "@/shared/auth";

setAuthAdapter(djangoAuthAdapter);
```

（import 放到檔頭既有 import 區；Biome organizeImports 會排序。）

- [ ] **Step 7: dev 環境預設值**

Create `frontend/.env.development`（Vite dev mode 自動載入；只含公開 URL，無機密）：

```bash
# dev 預設直連本機後端 (make up 起的 Docker API)。後端 CORS dev 預設已允許 localhost:5173。
VITE_API_BASE_URL=http://localhost:8000
```

Modify `frontend/.gitignore` 的 env 區塊，放行此檔：

```gitignore
# Env files (Vite)
.env*
!.env.example
!.env.development
```

Modify `frontend/.env.example`，最後一行改為附說明：

```bash
# API base URL（留空則以目前頁面同源為 API origin；Bearer token 只會送往此 origin）
# dev 預設值在 .env.development（http://localhost:8000）；要覆蓋時複製本檔為 .env.local
VITE_API_BASE_URL=
```

- [ ] **Step 8: 全套前端檢查**

Run: `cd frontend && bun run lint && bun run lint:fsd && bun run type-check && bun run test`
Expected: 全綠。（若 `lint` 對 main.tsx 的 import 排序有意見，先跑 `bun run format`。）

- [ ] **Step 9: Commit**

```bash
git add frontend/src/shared/auth frontend/src/main.tsx frontend/.env.development frontend/.gitignore frontend/.env.example
git commit -m "feat(frontend): wire real django auth adapter for /auth/* endpoints"
```

---

### Task 5: S3 + CloudFront 部署腳本

**Files:**
- Create: `scripts/deploy-frontend.sh`（chmod +x）

**Interfaces:**
- Consumes: `frontend/` 的 bun build（產出 `dist/`，hashed assets 在 `dist/assets/`）；環境變數 `FRONTEND_S3_BUCKET`、`CLOUDFRONT_DISTRIBUTION_ID`、`VITE_API_BASE_URL`
- Produces: `make deploy-frontend`（Task 2 已接上）可執行的部署流程

- [ ] **Step 1: 建立腳本**

```bash
#!/usr/bin/env bash
# 前端部署：bun build → S3 sync → CloudFront invalidation。
# 需求：aws CLI 已設好憑證；S3 bucket 與 CloudFront distribution 已建好
# （一次性設定見 docs/deployment.md）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

missing=()
[[ -z "${FRONTEND_S3_BUCKET:-}" ]] && missing+=("FRONTEND_S3_BUCKET (S3 bucket 名稱,例: my-app-frontend)")
[[ -z "${CLOUDFRONT_DISTRIBUTION_ID:-}" ]] && missing+=("CLOUDFRONT_DISTRIBUTION_ID (例: E1ABCDEF234567)")
[[ -z "${VITE_API_BASE_URL:-}" ]] && missing+=("VITE_API_BASE_URL (API 對外網域,例: https://api.your-domain.com)")
if ((${#missing[@]})); then
  echo "缺少必要環境變數:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  echo "用法: FRONTEND_S3_BUCKET=... CLOUDFRONT_DISTRIBUTION_ID=... VITE_API_BASE_URL=... make deploy-frontend" >&2
  exit 1
fi

command -v aws >/dev/null || { echo "找不到 aws CLI,請先安裝並設定憑證" >&2; exit 1; }
command -v bun >/dev/null || { echo "找不到 bun" >&2; exit 1; }

cd "$REPO_ROOT/frontend"

echo "==> 安裝依賴並建置 (VITE_API_BASE_URL=$VITE_API_BASE_URL)"
bun install --frozen-lockfile
VITE_API_BASE_URL="$VITE_API_BASE_URL" bun run build

echo "==> 上傳 hashed assets (長快取 immutable)"
aws s3 sync dist/assets "s3://$FRONTEND_S3_BUCKET/assets" \
  --cache-control "public,max-age=31536000,immutable"

echo "==> 上傳其餘檔案 (index.html 等,no-cache;--delete 清掉已移除的檔案)"
aws s3 sync dist "s3://$FRONTEND_S3_BUCKET" \
  --exclude "assets/*" \
  --exclude "*.map" \
  --cache-control "no-cache" \
  --delete

echo "==> CloudFront invalidation"
aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
  --paths "/*" \
  --query 'Invalidation.{Id:Id,Status:Status}' --output table

echo "==> 完成。驗證步驟見 docs/deployment.md 的「部署後驗證」。"
```

註：
- hashed assets 用 immutable 長快取；`index.html` 與 `public/` 靜態檔 no-cache，確保新版即時生效。
- `--exclude "*.map"`：hidden sourcemap 不上傳（供錯誤追蹤服務用，不對外）。
- `--delete` 不會刪被 exclude 的 `assets/*`（舊 hashed asset 留存，避免部署瞬間舊頁面抓不到 chunk）。

- [ ] **Step 2: chmod 並做無憑證煙霧測試**

```bash
chmod +x scripts/deploy-frontend.sh
./scripts/deploy-frontend.sh; echo "exit=$?"
bash -n scripts/deploy-frontend.sh && echo "syntax OK"
```

Expected: 第一次執行因缺環境變數而 exit=1，且錯誤訊息列出三個缺少的變數；`bash -n` 輸出 `syntax OK`。

- [ ] **Step 3: Commit**

```bash
git add scripts/deploy-frontend.sh
git commit -m "feat: add S3 + CloudFront frontend deploy script"
```

---

### Task 6: docs/development.md（開發指南）

**Files:**
- Create: `docs/development.md`

**Interfaces:**
- Consumes: Task 2 的頂層 Makefile targets、Task 4 的 `.env.development` 與 adapter 位置
- Produces: README（Task 8）連結的開發指南

- [ ] **Step 1: 撰寫 docs/development.md**

```markdown
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
| `make check-backend` | ruff format + lint + mypy + pytest |
| `make check-frontend` | biome + FSD 邊界 + tsc + vitest |

更深入的子專案指令與慣例：

- 後端：[backend/docs/local-development.md](../backend/docs/local-development.md)、`make -C backend help`
- 前端：[frontend/CLAUDE.md](../frontend/CLAUDE.md)（FSD 分層、新增 page 流程）

## 前後端如何串接

- **API base URL**：`frontend/.env.development` 設了
  `VITE_API_BASE_URL=http://localhost:8000`，dev 下前端直連後端。
  要覆蓋時在 `frontend/` 建 `.env.local`（優先權較高）。
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

## 疑難排解

| 症狀 | 原因 / 處理 |
| --- | --- |
| `make up` 失敗：cannot connect to Docker daemon | Docker 未啟動：`colima start` |
| port 8000 / 5173 被占用 | `lsof -i :8000` 找出佔用程序；或改 port（前端改 port 記得同步後端 CORS） |
| 登入時 browser console 出現 CORS 錯誤 | 後端沒起（`make logs`）；或前端不是跑在 5173/3000 |
| 登入回 429 | `/auth/login`、`/auth/register` 有 per-IP 節流，稍候再試 |
| API 回 500：relation does not exist | 忘了 `make migrate` |
| 前端顯示已登出（token 失效） | 後端 `make down -v` / token 過期屬正常；重新登入即可 |
```

- [ ] **Step 2: 驗證文內指令**

逐一確認文中指令與現況相符（不是跑一遍，是核對）：

```bash
test -f backend/.env.local.example && echo env-example-OK
rg -n "VITE_API_BASE_URL" frontend/.env.development
rg -n "setAuthAdapter\(djangoAuthAdapter\)" frontend/src/main.tsx
test -f backend/docs/local-development.md && echo backend-docs-OK
```

Expected: 每條都有輸出（`env-example-OK`、變數行、main.tsx 行、`backend-docs-OK`）。

- [ ] **Step 3: Commit**

```bash
git add docs/development.md
git commit -m "docs: add integration-level development guide"
```

---

### Task 7: docs/deployment.md（部署指南）

**Files:**
- Create: `docs/deployment.md`

**Interfaces:**
- Consumes: Task 5 的 `scripts/deploy-frontend.sh` 環境變數介面；`backend/docs/deployment.md`、`backend/docs/cloudflare-tunnel.md`
- Produces: README（Task 8）連結的部署指南

- [ ] **Step 1: 撰寫 docs/deployment.md**

```markdown
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
```

- [ ] **Step 2: 驗證連結與介面一致**

```bash
test -f backend/docs/deployment.md && test -f backend/docs/cloudflare-tunnel.md && echo links-OK
rg -n "FRONTEND_S3_BUCKET|CLOUDFRONT_DISTRIBUTION_ID|VITE_API_BASE_URL" scripts/deploy-frontend.sh | head -5
```

Expected: `links-OK`；腳本內三個環境變數名稱與文件一致。

- [ ] **Step 3: Commit**

```bash
git add docs/deployment.md
git commit -m "docs: add integration-level deployment guide (S3/CloudFront + tunnel backend)"
```

---

### Task 8: 頂層 README.md 與 CLAUDE.md

**Files:**
- Create: `README.md`
- Create: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 2 Makefile、Task 6/7 文件路徑
- Produces: 模板入口文件

- [ ] **Step 1: 撰寫 README.md**

```markdown
# Full-Stack Template

Django Ninja + React 全端專案模板。

| | 技術 | 目錄 |
| --- | --- | --- |
| 後端 | Django Ninja、Celery、PostgreSQL、Redis（uv + Docker） | [`backend/`](backend/) |
| 前端 | Vite、React 19、TypeScript、FSD、TanStack Router/Query（bun + Biome） | [`frontend/`](frontend/) |

開箱即含：真實 bearer token auth 串接（前端 `djangoAuthAdapter` ↔ 後端
`/auth/*`）、統一 Makefile、path-filtered CI、S3 + CloudFront 部署腳本。

## 快速開始

```bash
cp backend/.env.local.example backend/.env.local
make up && make migrate          # 後端: http://localhost:8000
cd frontend && bun install && cd ..
make dev                         # 前端: http://localhost:5173
```

完整步驟（含建帳號、疑難排解）→ **[docs/development.md](docs/development.md)**

## 部署

- 後端：單機 Docker Compose + Cloudflare Tunnel
- 前端：S3 + CloudFront（`make deploy-frontend`）

→ **[docs/deployment.md](docs/deployment.md)**

## 常用指令

`make help` 列出全部。子專案細節見 [`backend/README.md`](backend/README.md)
與 [`frontend/README.md`](frontend/README.md)。
```

- [ ] **Step 2: 撰寫 CLAUDE.md**

```markdown
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
```

- [ ] **Step 3: 驗證連結**

```bash
rg -o '\((?:docs|backend|frontend)/[^)]+\)' README.md CLAUDE.md -N | tr -d '()' | cut -d: -f2 | sort -u | while read -r f; do test -e "$f" && echo "OK $f" || echo "MISSING $f"; done
```

Expected: 全部 `OK`，無 `MISSING`。

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: add top-level README and CLAUDE.md"
```

---

### Task 9: 端對端驗收

**Files:**
- 無新檔案（驗證 + 必要時修正）

**Interfaces:**
- Consumes: 全部前置 task

- [ ] **Step 1: 起後端並準備帳號**

```bash
make up
sleep 15
make migrate
curl -s -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"e2e","email":"e2e@example.com","password":"pw12345678"}'
```

Expected: 回 `{"token":"..."}`（201）。若 429（同 IP 註冊節流）改用既有帳號或稍候。

- [ ] **Step 2: API 層驗證 login → me → logout**

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"e2e","password":"pw12345678"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -s http://localhost:8000/auth/me -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:8000/auth/logout -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/auth/me -H "Authorization: Bearer $TOKEN"
```

Expected: me 回 `{"id":...,"username":"e2e","email":"e2e@example.com"}`；logout 回 `{"detail":"Logged out, 1 token(s) revoked"}`（數字可能不同）；最後一行 `401`。

- [ ] **Step 3: 瀏覽器驗證前端串接**

```bash
make dev
```

手動：開 http://localhost:5173 → 用 `e2e / pw12345678` 登入 → header 顯示
`e2e` → 重新整理頁面仍為登入狀態（me 還原 session）→ 登出 → 導回登入頁。
DevTools Network 確認請求打到 `localhost:8000` 且無 CORS 錯誤。

（無法手動時的替代：`curl -s http://localhost:5173 | head -5` 確認 dev server
起得來，並以 Task 4 的 adapter 測試涵蓋邏輯；但**優先手動驗證**。）

- [ ] **Step 4: 全套品質檢查**

```bash
cd backend && make install && cd ..
make check
```

Expected: 後端 format/lint/mypy/pytest 與前端 biome/fsd/tsc/vitest 全綠。

- [ ] **Step 5: 收尾 commit（如驗收過程有修正）**

```bash
git status --short
# 若有修正: git add -A && git commit -m "fix: address issues found during e2e verification"
```

---

## Self-Review 紀錄

- **Spec coverage**：目錄結構（T1）、頂層 Makefile（T2）、CI + dependabot（T3）、auth 串接 + dev env（T4）、部署腳本（T5）、開發指南（T6）、部署指南（T7）、README/CLAUDE.md（T8）、驗收（T9）——spec 各節皆有對應。
- **Placeholder scan**：無 TBD/TODO；所有程式碼與文件內容完整給出。
- **Type consistency**：`djangoAuthAdapter` 名稱、`AuthAdapter` 介面、`tokenStorage` API、環境變數名（`FRONTEND_S3_BUCKET`/`CLOUDFRONT_DISTRIBUTION_ID`/`VITE_API_BASE_URL`）在 T4/T5/T6/T7/T8 間一致。
```
