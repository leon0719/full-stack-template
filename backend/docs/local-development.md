# 本地開發指南

日常開發全部跑在 Docker（API、PostgreSQL、Redis、Celery worker + beat），
程式碼熱重載；ruff / mypy 等品質工具則在本機跑（比較快，也給 IDE 用）。

## 需求

- Docker（macOS 建議 colima + docker CLI）
- [`uv`](https://github.com/astral-sh/uv)（本機工具鏈與 IDE 支援用）
- `make`

## 第一次啟動

```bash
cp .env.local.example .env.local   # 預設值即可直接啟動，見下方變數說明
make up                            # 啟動 API + DB + Redis + Celery worker/beat
```

啟動後：

- API：http://localhost:8000
- Swagger 文件：http://localhost:8000/api/docs
- 健康檢查：http://localhost:8000/health/live 、 /health/ready

建管理員帳號（Django admin 在 http://localhost:8000/admin/ ）：

```bash
make createsuperuser
```

（可選）本機安裝依賴，讓 IDE / mypy / pytest 找得到套件：

```bash
make install
```

## `.env.local` 環境變數

所有 app 端變數都經過 `config/settings/base.py` 的 pydantic `Settings` 類別
（不要在 app code 用 `os.getenv()`）。`ENV` 未設定時預設 `local`，
會載入 `.env.local`。

### 必填（example 檔已給可用值，通常不用動）

| 變數 | example 預設 | 說明 |
| --- | --- | --- |
| `SECRET_KEY` | `your-secret-key-here` | 本地用 placeholder 沒關係（只有 `ENV=prod` 會驗證強度） |
| `DATABASE_URL` | `postgresql://app:app@db:5432/app` | 對應 dev compose 的 Postgres（`POSTGRES_USER/PASSWORD/DB` 都是 `app`） |

### 已有合理預設、需要時才改

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `ENV` | `local` | 決定載入哪個 `.env.{ENV}` 檔；本地不用設 |
| `DJANGO_SETTINGS_MODULE` | `config.settings.local` | 給 `manage.py` / celery 讀（非 `Settings` 欄位） |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1,0.0.0.0,host.docker.internal` | Docker 健康檢查需要 localhost；`host.docker.internal` 給宿主機工具用 |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:5173` | 前端開發埠（Next.js / Vite）；換埠時改這裡 |
| `CELERY_BROKER_URL` | `redis://redis:6379/0` | dev compose 的 Redis |
| `CACHE_URL` | `redis://redis:6379/1` | 與 broker 分開的 Redis DB；注意 `local.py` 測試時會改用 in-memory cache，所以測試不需要 Redis |
| `ARTICLE_PUBLISHED_WEBHOOK_URL` | （空 = 停用） | 文章發布 webhook 的示範整合 |
| `LINE_LOGIN_CHANNEL_ID` | （空 = 停用） | LINE Developers Console 的 channel id；本地測試流程見頂層 `docs/development.md` |
| `LINE_LOGIN_CHANNEL_SECRET` | （空 = 停用） | LINE Developers Console 的 channel secret；本地測試流程見頂層 `docs/development.md` |
| `FRONTEND_BASE_URL` | `http://localhost:5173` | LINE 登入完成後導回前端的網址 |
| `DB_CONN_POOL` | `false` | psycopg3 連線池，本地用不到 |

### Tuning（皆有預設，整段可不設）

`AUTH_TOKEN_TTL_DAYS`（7）、`THROTTLE_WRITE_RATE`（30/m）、
`THROTTLE_LOGIN_RATE`（10/m）、`PAGE_SIZE`（20）、`MAX_PAGE_SIZE`（100）、
`NINJA_NUM_PROXIES`（1）、`SENTRY_DSN`（空 = 停用）。

> 改了 `.env.local` 之後要 `make down && make up`（或重啟該容器）才會生效——
> 設定在 process 啟動時讀入。

## 日常指令

### 開發循環

| 指令 | 用途 |
| --- | --- |
| `make up` / `make down` | 啟動 / 停止全部容器 |
| `make logs-api` | 看 API log（另有 `logs-worker` / `logs-beat` / `logs-db`） |
| `make rebuild` | 改了 Dockerfile 或 `pyproject.toml`（依賴）之後重建 |
| `make shell` | Django shell（容器內） |

程式碼改動不需要重啟——dev 容器掛載原始碼並開啟熱重載。

### 資料庫

| 指令 | 用途 |
| --- | --- |
| `make makemigrations` | 建 migration（容器內） |
| `make migrate` | 套用 migration（容器內） |
| `make makemigrations-local` | 本機建 migration（可 `APP="name"` 指定 app） |
| `make docker-clean` | 停容器並**刪除本地 DB/Redis 資料**（`data/`），重來一份乾淨環境 |

### 測試

| 指令 | 用途 |
| --- | --- |
| `make test` | 全部測試（Docker 內，用真 Postgres） |
| `make test TEST=apps/health/tests.py` | 跑單一檔案 |
| `make test-local` | 本機跑（不需 Docker；integration 測試走 in-memory SQLite） |
| `uv run pytest -m unit` | 只跑 unit 測試（本機） |
| `uv run pytest -m "not slow"` | 排除 slow 測試 |

測試一律標 `@pytest.mark.unit` 或 `@pytest.mark.integration`（strict markers，
沒標會直接報錯）。共用 fixture 在根目錄 `conftest.py`
（`user` / `other_user` / `auth_headers` 等，雙使用者是為了 IDOR 測試）。

### 品質檢查（本機執行，commit 前跑）

| 指令 | 用途 |
| --- | --- |
| `make all` | format + lint + type-check 一次跑完 |
| `make format` | `ruff format .` |
| `make lint` | `ruff check --fix .` |
| `make type-check` | `mypy .` |
| `make unused` | vulture 掃未使用的程式碼 |

也可裝 pre-commit hook，commit 時自動跑：在 **repo 根目錄**跑 `uv run --project backend pre-commit install`（設定檔是根目錄的 `.pre-commit-config.yaml`，前後端共用）。

> **為什麼 `make type-check` / `test-local` 不用先設環境變數？**
> Makefile 會先載入 `.env.local`（若存在），否則注入 dummy 的
> `SECRET_KEY` / `DATABASE_URL`——因為 `config.settings.local` 在 import 時
> 就會實例化 pydantic `Settings()`，缺這兩個必填欄位會直接失敗。

## 常見問題

| 症狀 | 處理 |
| --- | --- |
| `make up` 後 API 起不來 | `make logs-api` 看錯誤；最常見是 `.env.local` 沒建（`cp .env.local.example .env.local`） |
| port 8000 被佔用 | 找出佔用程序停掉，或改 dev compose 的 port mapping |
| 改了依賴（pyproject.toml）沒生效 | `make rebuild`（image 內是 `uv sync --frozen`，要重建） |
| DB schema 亂掉想重來 | `make docker-clean && make up`（會清掉本地資料） |
| 測試在本機找不到套件 | `make install` 先裝本機環境 |
