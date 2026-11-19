.PHONY: all format lint type-check test test-local openapi makemigrations-local coverage clean unused help audit
.PHONY: install update up down logs build rebuild
.PHONY: migrate makemigrations shell createsuperuser
.PHONY: docker-clean logs-api logs-db logs-worker logs-beat
.PHONY: prod-up prod-down prod-logs prod-build prod-backup prod-migrate
.PHONY: perf-seed perf

# Docker compose files
COMPOSE_DEV = docker compose -f docker/docker-compose.dev.yml
# --env-file 讓 compose 變數替換（${DOMAIN}、${CELERY_CONCURRENCY} 等）
# 讀得到 .env.prod；檔案不存在時省略（例如 CI 只做 build）。
COMPOSE_PROD = docker compose $(if $(wildcard .env.prod),--env-file .env.prod) -f docker/docker-compose.prod.yml

# Baked into the prod image as a build arg (docker-compose.prod.yml reads it);
# without this export, `make prod-build` would tag every image "unknown".
export GIT_COMMIT_SHA ?= $(shell git rev-parse HEAD 2>/dev/null || echo unknown)

# Load .env.local for local tooling (mypy / pytest / manage.py) if present, then
# fall back to dummy values so settings import even without a real .env.local.
# (mypy's django plugin and pytest both import config.settings.local, which needs
# SECRET_KEY + DATABASE_URL.)
LOCAL_ENV_FILE ?= .env.local
define LOAD_LOCAL_ENV
set -a; [ -f $(LOCAL_ENV_FILE) ] && . ./$(LOCAL_ENV_FILE) || true; \
: "$${SECRET_KEY:=dev-insecure-key}"; \
: "$${DATABASE_URL:=postgresql://app:app@localhost:5433/app}"; \
export SECRET_KEY DATABASE_URL; set +a;
endef

# ===================
# Help
# ===================

help:
	@echo "========================================"
	@echo "  Django Ninja Project Tree"
	@echo "========================================"
	@echo ""
	@echo "開發環境 (Docker):"
	@echo "  make up                - 啟動開發容器 (日常開發用)"
	@echo "  make down              - 停止開發容器"
	@echo "  make build             - 僅建構開發映像 (不啟動)"
	@echo "  make rebuild           - 重新建構並啟動 (修改 Dockerfile 或 pyproject.toml 後使用)"
	@echo "  make logs              - 查看所有服務日誌"
	@echo "  make logs-api          - 查看 API 日誌"
	@echo "  make logs-db           - 查看資料庫日誌"
	@echo "  make logs-worker       - 查看 Celery Worker 日誌"
	@echo "  make logs-beat         - 查看 Celery Beat 日誌"
	@echo ""
	@echo "生產環境 (Docker):"
	@echo "  make prod-build        - 建構生產映像"
	@echo "  make prod-backup       - 備份生產 DB 到 S3 一次 (BACKUP_S3_URI 未設定時只印警告)"
	@echo "  make prod-migrate      - 用新映像跑一次 migration (舊容器照常服務)"
	@echo "  make prod-up           - 先備份再啟動生產容器 (SKIP_BACKUP=1 略過備份)"
	@echo "  make prod-down         - 停止生產容器"
	@echo "  make prod-logs         - 查看生產日誌"
	@echo ""
	@echo "Django 指令 (在開發容器中執行):"
	@echo "  make migrate           - 執行資料庫遷移"
	@echo "  make makemigrations    - 建立新遷移檔 (可用 APP=\"name\" 指定 app)"
	@echo "  make makemigrations-local - 本地建立遷移檔 (可用 APP=\"name\" 指定 app)"
	@echo "  make shell             - 開啟 Django shell"
	@echo "  make createsuperuser   - 建立管理員帳號"
	@echo ""
	@echo "程式碼品質:"
	@echo "  make all               - 執行所有檢查 (format + lint + type-check)"
	@echo "  make format            - 格式化程式碼"
	@echo "  make lint              - 執行 ruff 檢查"
	@echo "  make type-check        - 執行 mypy 型別檢查"
	@echo "  make test              - 執行測試 (在開發容器中；可用 TEST=\"path\" 指定測試)"
	@echo "  make test-local        - 本地執行測試 (SQLite in-memory；設 TEST_DATABASE_URL 改用其他 DB)"
	@echo "  make coverage          - 執行測試並產生覆蓋率報告"
	@echo "  make unused            - 檢查未使用的程式碼 (vulture)"
	@echo "  make audit             - 掃描鎖定依賴的已知漏洞 (pip-audit，對等 CI)"
	@echo ""
	@echo "效能測試 (手動執行，見 docs/backend-standards.md):"
	@echo "  make perf-seed         - 在開發容器內建立/重用一批測試帳號 -> perf/.perf_users.json"
	@echo "  make perf              - 啟動 locust web UI (:8089)；ARGS=\"...\" 可傳 headless 參數"
	@echo ""
	@echo "其他:"
	@echo "  make install           - 安裝本地依賴 (僅供 IDE)"
	@echo "  make update            - 更新所有套件至最新版本"
	@echo "  make clean             - 清理快取檔案"
	@echo "  make docker-clean      - 清理開發環境 Docker 資料卷"

# ===================
# Local Setup (for IDE)
# ===================

install:
	uv sync

update:
	@echo "Updating all packages..."
	uv lock --upgrade
	uv run python scripts/update_pyproject_versions.py
	uv sync
	@echo "All packages updated!"

# ===================
# Development (Docker)
# ===================

up:
	$(COMPOSE_DEV) up -d
	@echo ""
	@echo "開發環境已啟動！"
	@echo "  API:      http://localhost:8000"
	@echo "  API Docs: http://localhost:8000/api/docs"
	@echo ""
	@echo "首次啟動請執行:"
	@echo "  make migrate"
	@echo "  make createsuperuser"

down:
	$(COMPOSE_DEV) down

build:
	$(COMPOSE_DEV) build

rebuild:
	$(COMPOSE_DEV) up -d --build

logs:
	$(COMPOSE_DEV) logs -f

logs-api:
	$(COMPOSE_DEV) logs -f api

logs-db:
	$(COMPOSE_DEV) logs -f db

logs-worker:
	$(COMPOSE_DEV) logs -f celery-worker

logs-beat:
	$(COMPOSE_DEV) logs -f celery-beat

docker-clean:
	$(COMPOSE_DEV) down -v
	rm -rf data/
	@echo "開發環境 Docker 資料卷及本地資料已清理"

# ===================
# Production (Docker)
# ===================

prod-build:
	$(COMPOSE_PROD) build

# 單次備份（docker/db_backup/backup.sh 的 BACKUP_ONESHOT 模式）：失敗就非 0 結束，
# 讓 prod-up / CD 停在 migration 之前——migration 沒有回頭路，先有備份才往下走。
prod-backup:
	$(COMPOSE_PROD) run --rm -T -e BACKUP_ONESHOT=1 backup

# 用剛 build 好的映像跑一次 migrate job（等同 prod-up 時的 migrate service，但可以先單獨確認成功）。
prod-migrate:
	$(COMPOSE_PROD) run --rm -T migrate

# 預設先備份再 up；CD 已經在 build 前備份過，會帶 SKIP_BACKUP=1 避免重複。
prod-up:
	@if [ "$(SKIP_BACKUP)" != "1" ]; then $(MAKE) prod-backup; fi
	$(COMPOSE_PROD) up -d
	@echo ""
	@echo "生產環境已啟動！"
	@echo "  API: http://localhost:8000"

prod-down:
	$(COMPOSE_PROD) down

prod-logs:
	$(COMPOSE_PROD) logs -f

# ===================
# Django Commands (in dev container)
# ===================

migrate:
	$(COMPOSE_DEV) exec api uv run python manage.py migrate

makemigrations:
	$(COMPOSE_DEV) exec api uv run python manage.py makemigrations $(APP)

shell:
	$(COMPOSE_DEV) exec api uv run python manage.py shell

createsuperuser:
	$(COMPOSE_DEV) exec api uv run python manage.py createsuperuser

# ===================
# Code Quality
# ===================

all:
	@echo "Running all code quality checks..."
	@echo ""
	@$(MAKE) format
	@echo ""
	@$(MAKE) lint
	@echo ""
	@$(MAKE) type-check
	@echo ""
	@echo "All checks completed!"

format:
	@echo "Formatting code with ruff..."
	@uv run ruff format .

lint:
	@echo "Linting code with ruff..."
	@uv run ruff check --fix .

type-check:
	@echo "Running type checks with mypy..."
	@bash -c '$(LOAD_LOCAL_ENV) uv run mypy .'

# OpenAPI schema for the frontend type generator (root `make gen-api`); no running server needed.
openapi:
	@bash -c '$(LOAD_LOCAL_ENV) uv run python manage.py shell -c "import json; from config.urls import api; open(\"../frontend/openapi.json\", \"w\").write(json.dumps(api.get_openapi_schema(), indent=2))"'

# DATABASE_URL is forced after loading .env.local, whose value (db:5432) only resolves inside Docker.
test-local:
	@echo "Running tests locally..."
	@bash -c '$(LOAD_LOCAL_ENV) DATABASE_URL="$${TEST_DATABASE_URL:-sqlite://:memory:}" uv run pytest $(TEST)'

makemigrations-local:
	@bash -c '$(LOAD_LOCAL_ENV) uv run python manage.py makemigrations $(APP)'

test:
	@echo "Running tests..."
	@$(COMPOSE_DEV) exec api uv run pytest $(TEST)

coverage:
	@echo "Running tests with coverage..."
	@$(COMPOSE_DEV) exec api uv run pytest --cov=apps --cov-report=term-missing --cov-report=html $(TEST)
	@echo ""
	@echo "HTML 報告已產生至 htmlcov/ 目錄"

unused:
	@echo "Checking for unused code with vulture..."
	@uv run vulture apps config

# Local equivalent of the CI `audit` job: export the locked (uv.lock) runtime
# dependency set and scan it for known vulnerabilities with pip-audit.
audit:
	@echo "Auditing locked dependencies for known vulnerabilities..."
	@uv export --frozen --no-dev --no-emit-project --format requirements-txt -o requirements-audit.txt
	@uvx pip-audit==2.10.1 --disable-pip -r requirements-audit.txt; status=$$?; rm -f requirements-audit.txt; exit $$status

# ===================
# Performance Testing (manual, not in CI — see docs/backend-standards.md)
# ===================

# Seeds go through the ORM inside the api container (DATABASE_URL already
# points at the dev DB there), not through the host, so no local DB config is needed.
perf-seed:
	@echo "Seeding perf test user pool..."
	@$(COMPOSE_DEV) exec -T api uv run python manage.py seed_perf_users --count 20 > perf/.perf_users.json
	@echo "Wrote perf/.perf_users.json"

perf:
	@uv run --group perf locust -f perf/locustfile.py --host http://localhost:8000 $(ARGS)

# ===================
# Cleanup
# ===================

clean:
	@echo "Cleaning cache files..."
	@find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	@find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	@find . -type d -name ".mypy_cache" -exec rm -rf {} + 2>/dev/null || true
	@find . -type d -name ".ruff_cache" -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name "*.pyc" -delete 2>/dev/null || true
	@rm -rf htmlcov .coverage 2>/dev/null || true
	@echo "Cache cleaned!"
