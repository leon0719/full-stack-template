# 整合與非同步規範

第三方 API、快取、Celery 非同步任務、SSE/WebSocket、Webhook 的慣例與現況。
跟 `api-standards.md`（對外契約）、`backend-standards.md`（架構/DB/機密）互補。
✅ 已遵守／⚠️ 部分遵守／❌ 未實作（含補的話要注意什麼）。

## 第三方 API 串接

| 項目 | 狀態 | 備註 |
|---|---|---|
| `httpx` 只能出現在 `external_services.py` | ✅ | CLAUDE.md 明文規定；views/services 不直接發 HTTP |
| 統一包裝：`@handle_api_call` / `@handle_api_call_graceful` | ✅ | `config/external_api_handler.py`：tenacity 重試 + loguru + 轉譯成 `HttpError`，不洩漏原始 httpx 例外 |
| 兩種裝飾器的選擇 | ✅ | 呼叫端**需要結果**（呼叫失敗就該讓這個 request 失敗）→ `handle_api_call`；**best-effort 副作用**（失敗不該拖垮主流程，如發通知）→ `handle_api_call_graceful` |
| 明確設定 timeout | ✅ | 每個外部呼叫都要設（如 `_WEBHOOK_TIMEOUT_SECONDS = 5.0`），不要吃 httpx 預設值 |
| Webhook 接收（LINE Login OAuth callback） | ✅ | `apps/accounts` 的 LINE OAuth 交換屬於本專案獨有整合層，見 `backend/CLAUDE.md` 說明；不在上游 `apps/articles` webhook 範例的涵蓋範圍內 |
| Circuit breaker | ❌ 不採用 | tenacity 重試 + graceful 降級已經夠用；這個規模還沒有「同一個壞掉的第三方被打爆」的量級問題，加 circuit breaker 是過度設計 |

## 快取

| 項目 | 狀態 | 備註 |
|---|---|---|
| 統一走 Django cache framework | ✅ | `caches["default"]`（prod 是 Redis，local 是 LocMemCache），不要在 app 裡直接接 redis client |
| Throttle counter 存 cache | ✅ | `AnonRateThrottle`/`WriteRateThrottle` |
| 健康檢查結果短 TTL 快取 | ✅ | `apps/health/views.py` 的 `cache.set("health:ping", ..., timeout=5)`，避免多個監控/readiness probe 同時打進來時每次都真的敲一次 DB/Celery |
| 讀穿透型業務資料快取 | ❌ 尚未需要 | 目前沒有「查 DB 前先查 Redis」的快取，見下方「讀穿透型業務快取 / 失效策略」 |
| Cache 失效策略 | ❌ 尚未需要 | 目前沒有需要主動失效的快取（health check 的 5 秒 TTL 讓它自然過期就夠），見下方 |

## 非同步任務（Celery）

| 項目 | 狀態 | 備註 |
|---|---|---|
| Task 傳 primitive 參數，不傳 model instance | ✅ | CLAUDE.md 規定；`notify_article_published(article_id: int)` 而非傳 `Article` 物件 |
| Task 必須冪等 | ✅ | `CELERY_TASK_ACKS_LATE=True` + `CELERY_TASK_REJECT_ON_WORKER_LOST=True`，worker 掛掉時任務會重跑，任務本身要能重複執行不出錯 |
| `acks_late` vs `autoretry_for` 的分工 | ✅ | `acks_late`：worker **process 死掉**時重跑（防的是基礎設施故障）；`autoretry_for`：task **內部丟例外**時重跑（防的是暫時性錯誤，如 DB 連線斷線）。兩者防的是不同層的失敗，見 `apps/articles/tasks.py` 註解 |
| `autoretry_for` 只抓真正暫時性的例外 | ✅ | `autoretry_for=(OperationalError,)`，不要用裸 `Exception`——用裸 `Exception` 會把真正的 bug（`KeyError`/`TypeError`）也重試 3 次才報錯，白白延遲告警 |
| 不要疊加兩層 retry | ✅ | task 的 `autoretry_for` 不要疊在 `@handle_api_call`（本身有 tenacity 重試）之上，重試次數會相乘；fire-and-forget 的外部呼叫走 `@handle_api_call_graceful`（自己吞錯誤），task 本身不需要再重試 |
| 「純訊號」任務絕不可拋例外 | ✅ | `core.beat_heartbeat`／`core.check_queue_depth`：這兩支任務存在的目的是把「服務悄悄壞掉」變成可偵測事件；如果自己丟例外，Celery 會記成「任務失敗」，跟它們真正要回報的訊號（心跳有沒有到、佇列有沒有塞）混在一起，見 `apps/core/tasks.py` |
| `@shared_task(name=...)` 明確命名 | ✅ | 每個 task 都寫 `name="app.task_name"`，不要依賴自動推導的 dotted path（模組搬家會跟著壞掉） |
| Soft/hard time limit | ✅ | `CELERY_TASK_SOFT_TIME_LIMIT=300` / `CELERY_TASK_TIME_LIMIT=360`；長任務要處理 `SoftTimeLimitExceeded` 或拆更小的 task |
| `worker_prefetch_multiplier=1` | ✅ | 避免一個 worker 一次搶走一大批任務，導致其他 worker 空閒、長任務排隊 |
| Beat 排程用 `DatabaseScheduler` | ✅ | `django_celery_beat`，排程存 DB 可動態調整不用重新部署 |

## SSE（Server-Sent Events）

| 項目 | 狀態 | 備註 |
|---|---|---|
| SSE endpoint | ❌ 未實作 | 上游模板有參考實作（`GET /api/v1/realtime/sse`，`apps/realtime/views.py` 的 `stream_notifications`，`BearerAuth` 認證，`StreamingHttpResponse` + `content_type="text/event-stream"`），本專案目前沒有即時通知需求，未引入 `apps/realtime` |
| 保持連線不被中介緩衝打斷 | ❌ 未實作 | 要補時參考上游做法：回應加 `Cache-Control: no-cache` + `X-Accel-Buffering: no`；正式場景用純 `: ping\n\n` 註解行維持連線，不夾帶內容 |
| 跟 WebSocket 共用同一套推播機制 | ❌ 未實作 | 上游用 per-user channel layer group（`user_group_name()`）讓 SSE/WS 共用同一個 `push_notification()` |
| 節流模型不適用長連線 | ❌ 未實作 | 若之後補上 SSE/WS，記得不要掛 `AnonRateThrottle`/`WriteRateThrottle`（per-request 計數模型不適用長連線），並考慮 per-user 同時連線數上限 |

## WebSocket

| 項目 | 狀態 | 備註 |
|---|---|---|
| WebSocket endpoint | ❌ 未實作 | 上游用 Django Channels（`apps/realtime/consumers.py` 的 `NotificationConsumer`，路徑 `/ws/notifications/`，`config/asgi.py` 的 `ProtocolTypeRouter`，不吃 `/api/v1` 前綴）；本專案未引入 `channels` 依賴 |
| Channel layer：Redis in prod，記憶體 in local | ❌ 未實作 | 若要補，比照上游 `CHANNEL_LAYERS`（`channels_redis` 沿用 `CACHE_URL`，`local.py` 換成 `InMemoryChannelLayer`），注意 `make up` 的 `api`/`celery-worker`/`celery-beat` 是三個獨立容器，各自有自己的記憶體 channel layer，跨 process 推播要用 Redis-backed layer |
| Token 認證（非 cookie session） | ❌ 未實作 | 若要補，可沿用既有 `authenticate_token()`（`apps.accounts.authentication`）；瀏覽器原生 WebSocket API 無法自訂 handshake header，需額外支援 `?token=` query string fallback |
| Consumer 內的 group add/discard | ❌ 未實作 | 上游做法：`connect()` 加入 `user_<id>` group、`disconnect()` 離開；驗證失敗在 `accept()` 之前 `close()` |

## Webhook（Outbound）

| 項目 | 狀態 | 備註 |
|---|---|---|
| 參考實作 | ✅ | `apps/articles/external_services.py` 的 `notify_article_published_webhook()` |
| Best-effort，不拖垮主流程 | ✅ | `@handle_api_call_graceful`；第三方端點掛掉不能讓文章發佈失敗 |
| 由 Celery task 呼叫，非同步發送 | ✅ | `apps/articles/tasks.py`，不在 request-response 週期內直接呼叫，避免拖慢 API 回應 |
| 功能旗標：URL 為空即停用 | ✅ | `ARTICLE_PUBLISHED_WEBHOOK_URL` 空字串 = 整合關閉，不用額外的 boolean flag |
| At-least-once + 消費端去重欄位 | ✅ | payload 帶 `event_id`（用 Celery task id，重試/重送都穩定），消費端要拿它做去重，不能假設 exactly-once |

## 讀穿透型業務快取 / 失效策略（要加的話注意這幾點）

1. 命名空間化 cache key：`<app>:<entity>:<id>`，避免多個 app 共用同一個 Redis 時互相碰撞。
2. 防穿透：查無資料也快取一個短 TTL 空值（sentinel），避免每次都真的打到 DB。
3. 防雪崩：TTL 加隨機抖動，避免大量 key 同時到期造成瞬間洪峰。
4. 寫入路徑同步 invalidate：加了讀快取後，對應資料被寫入/更新時要主動刪除快取 key，不要只靠 TTL 自然過期（否則會有一段時間讀到舊資料）。
