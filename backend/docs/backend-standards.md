# 後端系統規範

跟 `api-standards.md`（API 對外契約）互補：這份涵蓋架構、DB、機密管理、併發/快取、
可觀測性、測試等內部規範。✅ 已遵守／⚠️ 部分遵守／❌ 不採用（理由見備註）。

| 項目 | 狀態 | 備註 |
|---|---|---|
| 分層架構 (views/services/ORM) | ✅ | 見 CLAUDE.md「App Layering」 |
| 獨立 Repository/DAO 層 | ❌ 不採用 | Django `Manager`/`QuerySet` 本身就是資料存取抽象；`OwnedResourceService` 已集中管理，多包一層是空殼 wrapper |
| 正式 DI 容器 / Interface 注入 | ❌ 不採用 | Django 無此慣例；用泛型 mixin 重用，測試靠 pytest fixture + 真實 test DB |
| 單一職責分層 | ✅ | `schema.py`/`services.py`/`external_services.py`/`tasks.py`/`utils.py` 職責明確 |
| Migration 版本控制 | ✅ | Django migrations；CI `makemigrations --check --dry-run` 擋忘記產生 |
| N+1 防護 (`select_related`/`prefetch_related`) | ✅ | 用在會 N+1 的地方（`authentication.py`、`admin.py`、`OwnedResourceService.select_related`） |
| 避免 `SELECT *` | ⚠️ 不適用 | Django ORM 無裸 SQL 問題；model 都不夠寬，`.only()`/`.values()` 目前無實際需要 |
| Transaction 包裹多步驟寫入 | ✅ | `transaction.atomic()`（`accounts/services.py`）；articles 用單一原子 UPDATE 不需額外包 |
| Index 對應實際查詢路徑 | ✅ | `Article.Meta.indexes`：`(owner, -created_at)` 服務預設列表排序、`(owner, status)` 服務 `?status=` 篩選；新增查詢先想清楚會用哪個 index，不要建低選擇性的單欄位 index（如裸 `status`） |
| Primary Key：`BigAutoField`，非 UUID | ✅ 刻意 | 單一 Postgres、無多區域/離線寫入需求，且 IDOR 已靠 `get_owned_or_404()` 擋（猜到 ID 也拿不到別人的資料），純數字 index 更小更快、log 也好讀。**換成 UUIDv7 的時機**：需要 client 端在 insert 前先產生 ID（離線佇列、冪等 create）、多區域 active-active 寫入要合併不撞號、或 ID 會外露在公開 URL 且在意洩漏成長量。Python 3.14 內建 `uuid.uuid7()`、Postgres 18 內建 `uuidv7()`，真要換不需要額外套件：`models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)` |
| `on_delete` 明確宣告 | ✅ | 目前都是 `CASCADE`（user 被刪，articles/tokens 隨之刪除）；新增 FK 前先判斷父列被刪時子列該砍還是該留（`PROTECT`/`SET_NULL`），不要漏填讓 Django 預設報錯逼你補 |
| `related_name` 明確宣告 | ✅ | 每個 FK 都寫，避免 Django 自動產生的 `_set` 反向查詢名稱難猜 |
| `TimestampedModel` 統一時間戳 | ✅ | `apps/core/models.py` 抽象 mixin 提供 `created_at`/`updated_at`；新 model 一律繼承，不要各自宣告 |
| DB 連線池 | ✅ | `config/settings/base.py` 的 `DB_CONN_POOL` 分支：`DB_CONN_POOL=True` 時用 psycopg3 pool（`CONN_MAX_AGE=0` + min/max size，因為 uvicorn 自己管連線生命週期，不能疊加 Django persistent connection）；關閉時走傳統 `CONN_MAX_AGE=600` + `CONN_HEALTH_CHECKS=True`。改這段前要理解兩種模式互斥的原因，不要兩個一起開 |
| 過期資料清除 | ✅ | `AuthToken` 用 `expiry` 欄位；`authenticate_token()` 驗證時 lazy 刪過期 token，`accounts.purge_expired_tokens`（Celery Beat 排程）補刪從未被使用過的過期 token。新增有時效性的資料一律比照這個「lazy 刪 + beat 排程補漏」雙保險模式 |
| 資料庫備份/還原 | ✅ 刻意外包 | prod compose 不含 DB/Redis，備份策略交給外部託管服務負責（`docs/deployment.md`「維運備忘」）；app 主機本身無狀態，備份/還原不是這個 repo 的責任範圍 |
| Twelve-Factor Config | ✅ | pydantic `Settings` 讀 `.env.{ENV}`，app 不用裸 `os.getenv()` |
| Secret 不進版控 | ✅ | `.gitignore` 排除 `.env*`；CI gitleaks scanning |
| Secret 型別化 (`SecretStr`) | ✅ | `SECRET_KEY`/`DATABASE_URL`/`CELERY_BROKER_URL`/`SENTRY_DSN` 等 |
| Secret 輪替政策 | ❌ 未定義 | 目前沒有文件化的輪替流程，見下方「Secret 輪替政策」 |
| 密碼雜湊 (Argon2id) | ✅ | `PASSWORD_HASHERS`，舊 hash 登入時自動升級 |
| PII 去敏 (log/Sentry) | ✅ | `send_default_pii=False` + `max_request_body_size="never"`；`_sanitize_errors()` |
| 冪等性設計 | ✅ | 見 `api-standards.md` |
| 快取穿透/雪崩防護 | ⚠️ 不適用 | cache 僅用於健康檢查/throttle counter，非讀穿透型業務快取；加熱資料快取時才需要補（空值 sentinel + TTL 抖動） |
| 限流 (Rate Limiting) | ✅ | `AnonRateThrottle`/`WriteRateThrottle` |
| 結構化 JSON 日誌 | ✅ | loguru，prod `serialize=True` |
| Log 等級規則 (4xx warning / 5xx error) | ✅ | CLAUDE.md Code Style |
| 優雅關機 (SIGTERM) | ✅ | `uvicorn_run.py` `timeout_graceful_shutdown=30` |
| `X-Request-ID` 貫穿 log | ✅ | `config/middleware.py` 的 `RequestIDMiddleware`，見 `api-standards.md`（這條先前誤標成「暫不補」，是文件沒同步，功能其實已經在） |
| 告警覆蓋 Sentry 看不到的故障 | ✅ | beat 心跳、佇列積壓、task 失敗 signal，見 `docs/alerting.md` |
| Unit/Integration 測試標記分離 | ✅ | `pyproject.toml` strict markers |
| Testcontainers | ❌ 不採用 | 用常駐 `docker-compose.dev.yml` Postgres 達到同等效果（真實 DB），規模用不到動態隔離 |
| CI Gate (lint/type/test/migration/deploy-check) | ✅ | `.github/workflows/ci.yml` |
| Merge 前強制 CI 通過 | ⚠️ 需人工確認 | GitHub Branch Protection 設定，不在程式碼裡，需到 repo Settings 確認 |
| 效能測試/負載測試 | ❌ 未引入 | 上游模板有 `perf/locustfile.py` + `make perf-seed`/`make perf`（見下方「效能測試/負載測試」），本專案尚未引入 `perf/` 目錄，需要時可整包搬過來 |

## Secret 輪替政策

1. `SECRET_KEY`：只影響 Django session cookie 簽章與 CSRF（跟 `AuthToken` API 認證完全無關，見 `apps/accounts`），換掉頂多讓還在用 Django admin 的人被登出重新登入，不影響 API client。建議定期輪替（如每季）排提醒。
2. `DATABASE_URL`/`CELERY_BROKER_URL`/`CACHE_URL`：密碼輪替是 infra 層的工作（換資料庫/Redis 使用者密碼 → 更新 env var → 重新部署），照託管服務原生的憑證輪替流程走即可，沒有這個專案特有的複雜度。
3. `SENTRY_DSN`：外洩風險低（頂多被灌垃圾事件），輪替優先度低於上述兩者。
4. 目前都是人工流程，沒有自動化輪替機制；先確保「換完密鑰要記得重新部署」這一步不會被漏掉，還不需要額外自動化。

## 效能測試/負載測試（尚未引入，需要時參考上游模板）

上游 `django-ninja-backend-template` 的做法：

1. 工具選擇：用 [locust](https://locust.io/)（Python，跟專案其他工具鏈一致，用 `uv --group perf` 裝，不污染主要 `dev` 依賴）。不需要一開始就追求完整壓測平台。
2. 涵蓋端點：`perf/locustfile.py` 涵蓋登入與核心 CRUD 這幾個高頻/高風險路徑。
3. **Throttle-aware，不是繞過 throttle**：per-IP 節流（如 `LoginThrottle`）從單一 load-gen host 打會先測到 throttle 本身而不是端點吞吐量。因此：
   - 測試帳號池用 seed 指令（直接寫 DB + 發 token，不經過真正的註冊流程）預先建立，帳號池夠大就能線性擴大 per-user 節流端點的測試量。
   - 登入這類路徑刻意用低 `weight`、低並發：真實產能上限本來就是設計出來的（防 credential stuffing），測的是延遲不是吞吐量。
4. 不需要進 CI：效能測試通常執行時間長、結果易受環境影響波動，先當手動/定期執行的工具，不用一開始就卡進 CI gate。
5. 現有的個別防護不等於系統性驗證：DB connection pool、`select_related` 防 N+1、throttle rate 都只是點狀防護，實際吞吐量/延遲基準需要真的跑一輪才能確認。

## 新增功能檢查清單

1. Migration 有沒有跟著 model 改動一起產生
2. 多步驟寫入是否需要 `transaction.atomic()`
3. 新查詢是否會在迴圈裡碰 FK → 需不需要 `select_related`/`prefetch_related`
4. 新增的密碼/token/連線字串設定是否用 `SecretStr`
5. 第三方呼叫/log 訊息是否可能把 PII 送進 Sentry/log
6. 測試標記 `unit`/`integration` 是否正確反映有沒有碰真實 DB
