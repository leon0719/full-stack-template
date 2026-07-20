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
	cd frontend && bun run lint:ci && bun run lint:fsd && bun run type-check && bun run test

check: check-backend check-frontend

deploy-frontend:
	./scripts/deploy-frontend.sh
