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
