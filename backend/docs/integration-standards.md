# 整合與非同步規範

第三方 API、快取、Celery 非同步任務、SSE/WebSocket、Webhook 的慣例與現況。
跟 `api-standards.md`（對外契約）、`backend-standards.md`（架構/DB/機密）互補。
✅ 已遵守／⚠️ 部分遵守／❌ 未實作（含補的話要注意什麼）。

## 第三方 API 串接

| 項目 | 狀態 | 備註 |
|---|---|---|
| `httpx` 只能出現在 `external_services.py` | ✅ | ruff `TID251` banned-api 強制（`pyproject.toml`）；views/services 一 import 就 lint 失敗 |
| 統一包裝：`@handle_api_call_graceful` | ✅ | `config/external_api_handler.py`：tenacity 重試 + loguru，重試耗盡後降級成 `default_return`，不洩漏原始 httpx 例外 |
| 呼叫端需要結果時 | ✅ | 裝飾器只負責 best-effort 降級。呼叫失敗就該讓這個 request 失敗的情境，由 service 層判斷 `default_return` 並丟 `AppError`／`HttpError`，錯誤語意留在知道領域含義的那一層 |
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
| 關機時仍在跑的任務 | ✅ | prod worker 設 `REMAP_SIGTERM=SIGQUIT` + `CELERY_WORKER_SOFT_SHUTDOWN_TIMEOUT=30`：SIGTERM 後執行中的任務有 30 秒收尾，沒做完的被取消並**立刻退回佇列**（acks_late），不必等 `visibility_timeout`（1h）。代價是有任務在跑時關機固定等滿 30 秒。任務被中途取消再重跑，所以仍必須冪等；`stop_grace_period`（60s）必須大於 soft timeout，否則會先被 SIGKILL 回到舊的 1 小時延遲 |
| Worker process 崩潰的重送沒有上限 | ⚠️ 已知風險 | `reject_on_worker_lost` 會把任務無限次重新排回佇列：一支「必定讓 process 崩潰」的任務（segfault、OOM kill）會一直循環，而且因為每次都被重新排回，**不會觸發 `task_failure` signal**（`config/alerting.py` 的結構化失敗 log 收不到）。症狀是同一個 task id 反覆出現、佇列積壓；看到時要手動清掉該訊息 |
| `acks_late` vs `autoretry_for` 的分工 | ✅ | `acks_late`：worker **process 死掉**時重跑（防的是基礎設施故障）；`autoretry_for`：task **內部丟例外**時重跑（防的是暫時性錯誤，如 DB 連線斷線）。兩者防的是不同層的失敗，見 `apps/articles/tasks.py` 註解 |
| `autoretry_for` 只抓真正暫時性的例外 | ✅ | `autoretry_for=(OperationalError,)`，不要用裸 `Exception`——用裸 `Exception` 會把真正的 bug（`KeyError`/`TypeError`）也重試 3 次才報錯，白白延遲告警 |
| 不要疊加兩層 retry | ✅ | task 的 `autoretry_for` 不要疊在 `@handle_api_call_graceful`（本身有 tenacity 重試）之上，重試次數會相乘；fire-and-forget 的外部呼叫走 `@handle_api_call_graceful`（自己吞錯誤），task 本身不需要再重試 |
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
| Token 認證（非 cookie session） | ❌ 未實作 | 若要補，比照上游：`Authorization` header 沿用既有 `BearerAuth` 的驗證；瀏覽器原生 WebSocket / EventSource 不能帶 header，`?token=` **只收短效 stream token**（上游 `POST /auth/stream-token`：60 秒、scope=stream、綁定發出它的 bearer token），**絕不收 bearer token**——URL 會進 proxy access log 與瀏覽器歷史。前端 `shared/api` 的 `useEventStream` 已照這個契約寫好（`getStreamToken`），後端補上 SSE + stream-token 端點即可接上 |
| Consumer 內的 group add/discard | ❌ 未實作 | 上游做法：`connect()` 加入 `user_<id>` group、`disconnect()` 離開；驗證失敗在 `accept()` 之前 `close()` |

## Webhook（Outbound）

| 項目 | 狀態 | 備註 |
|---|---|---|
| 參考實作 | ✅ | `apps/articles/external_services.py` 的 `notify_article_published_webhook()` |
| Best-effort，不拖垮主流程 | ✅ | `@handle_api_call_graceful`；第三方端點掛掉不能讓文章發佈失敗 |
| 由 Celery task 呼叫，非同步發送 | ✅ | `apps/articles/tasks.py`，不在 request-response 週期內直接呼叫，避免拖慢 API 回應。enqueue 用 `transaction.on_commit(..., robust=True)`（`apps/articles/views.py`）：發布已經 commit，broker 不通時只記 error log、**這次 webhook 直接丟掉**，不讓 PATCH 回 500（重試也無法再認領 draft→published 轉換） |
| 功能旗標：URL 為空即停用 | ✅ | `ARTICLE_PUBLISHED_WEBHOOK_URL` 空字串 = 整合關閉，不用額外的 boolean flag |
| Best-effort 投遞 + 消費端去重欄位 | ⚠️ 非 at-least-once | 不保證送達：broker 不通時 enqueue 就丟掉（見上），暫時性錯誤重試用完、或對方回 HTTP 錯誤時也直接放棄。也可能重複（worker 崩潰重送），所以 payload 帶 `event_id`（用 Celery task id，重試/重送都穩定），消費端要拿它做去重，不能假設 exactly-once。需要保證送達時照下方「通知 outbox」的模式（outbox 表 + beat 補送 + 放棄告警） |

## 讀穿透型業務快取 / 失效策略（要加的話注意這幾點）

1. 命名空間化 cache key：`<app>:<entity>:<id>`，避免多個 app 共用同一個 Redis 時互相碰撞。
2. 防穿透：查無資料也快取一個短 TTL 空值（sentinel），避免每次都真的打到 DB。
3. 防雪崩：TTL 加隨機抖動，避免大量 key 同時到期造成瞬間洪峰。
4. 寫入路徑同步 invalidate：加了讀快取後，對應資料被寫入/更新時要主動刪除快取 key，不要只靠 TTL 自然過期（否則會有一段時間讀到舊資料）。

## 通知（Email / LINE）與 outbox

| 項目 | 狀態 | 備註 |
|---|---|---|
| 一律經過 outbox | ✅ | 業務程式只呼叫 `apps.notifications.services.NotificationService.enqueue_email()` / `enqueue_line()`：先寫一筆 `Notification`，`transaction.on_commit` 後排入 `notifications.send_notification`。在業務交易內呼叫時跟業務資料同一個 commit（transactional outbox）：業務回滾就不送，業務成功就一定留在表裡。**不要**在 request/service 裡直接 `send_mail()` 或打 LINE API |
| 發送與重試 | ✅ | 送出前以 rows-affected UPDATE 認領（`locked_until`，5 分鐘），「立即發送」與「beat 補送」不會同時送同一則；失敗記 `retry_count` / `last_error`。`notifications.retry_pending_notifications` 每 10 分鐘撿起建立超過 1 分鐘仍未送出的（含 broker 不通沒排進去、worker 送到一半死掉的）。task **不設** `autoretry_for`，次數只由 outbox 計 |
| 放棄與告警 | ✅ | `retry_count >= NOTIFICATION_MAX_RETRIES`（預設 5）→ `abandoned_at` + `config.alerting.alert()`（Sentry error → Slack，見 `docs/alerting.md` 第 7 節）。admin 可「重新發送」；`GET /notifications/failed`（admin 角色）列出未送出的 |
| 投遞語意 | ⚠️ at-least-once | 送出後、標記 sent 前 worker 死掉會再送一次。LINE 用每則固定的 `idempotency_key` 當 `X-Line-Retry-Key`（LINE 回 409 = 先前已送達，視為成功）；email 帶 `X-Notification-Id` header，但收件端通常不去重，接受極少數重複 |
| Email | ✅ | Django 6.1 `MAILERS`：`EMAIL_HOST` 有值 → SMTP（timeout `EMAIL_TIMEOUT`），留空 → `LogOnlyEmailBackend`（只記收件人數與標題，不記內文）；`local.py` 固定 console，測試自動 locmem（`django.core.mail.outbox`）。非 prod 的標題一律加 `[DEV]`。SMTP 錯誤（`SMTPException` / `OSError`）記進 outbox 重試 |
| LINE push | ✅ | `apps/notifications/external_services.py` 的 `push_line_message()`（`@handle_api_call_graceful`，timeout 10s）。不 `raise_for_status`：HTTP 錯誤轉成結果物件帶回錯誤碼與 body 前 300 字，outbox 才記得到原因（429 = 當月配額用完）。token 未設定時只寫 log 並視為已送出（開發環境不累積重試與告警） |
| 推播給某個使用者（LINE Login → userId） | ✅ | `NotificationService.enqueue_line_to_user(user, texts, source=)`：從 `LineProfile.line_user_id`（LINE Login 時由 `apps/accounts/adapters.py` 存下）取 userId 再走 `enqueue_line()`；沒有 `LineProfile` 的帳號（`createsuperuser` 建的管理員）回 `None`、不建 outbox 列 |
| ⚠️ Login channel 與 Messaging channel 必須同一個 provider | ⚠️ 設定前提 | LINE 的 userId 是 **per-provider**：LINE Login channel（`LINE_LOGIN_*`）與 Messaging API channel（`LINE_MESSAGING_*`）在 LINE Developers Console 必須建在**同一個 provider** 底下，Login 拿到的 userId 才推得到同一個人；不同 provider 會得到另一串 userId，push 回 4xx、重試耗盡後告警。另外使用者必須已加官方帳號（Messaging channel 的 bot）為好友才收得到——可在 LINE Login channel 開「Linked LINE Official Account」，並在 allauth 的 `SOCIALACCOUNT_PROVIDERS["line"]` 加 `"AUTH_PARAMS": {"bot_prompt": "aggressive"}`，讓登入同意畫面順便提示加好友（本模板未預設開啟） |
| 已結束紀錄清理 | ✅ | `notifications.purge_old_notifications` 每天刪 sent/abandoned 超過 `NOTIFICATION_RETENTION_DAYS`（預設 90）天的；pending 的永遠不刪 |

## Webhook（Inbound）

| 項目 | 狀態 | 備註 |
|---|---|---|
| 驗簽在任何處理之前 | ✅ | `apps/notifications/utils.py` 的 `verify_line_signature()`：channel secret 對**原始 request body bytes** 做 HMAC-SHA256 再 base64，`hmac.compare_digest` 定時比較。先 parse 再 dump 會改變位元組，一定要用 `request.body` |
| 失敗回應 | ✅ | 簽章不符 401 `invalid_signature`（不說明原因）；`LINE_MESSAGING_CHANNEL_SECRET` 未設定 503；簽章對但 body 不是 JSON 400 |
| 不記 body | ✅ | LINE 的 body 有使用者 userId 與訊息內容（個資），log 只記事件 type |
| 快速回 200 | ⚠️ 需注意 | LINE 約 1 秒沒收到 200 會重送。耗時處理丟 Celery task，且以 `webhookEventId` 去重（目前範例只記 log，沒有去重表） |
| 節流 | ❌ 未加 | 驗簽本身很便宜，偽造請求在驗簽就被擋；有大量垃圾流量時在 nginx/Cloudflare 層擋 |

## 長任務（`apps/jobs`）

| 項目 | 狀態 | 備註 |
|---|---|---|
| 狀態存 DB，不用 result backend | ✅ 刻意 | `CELERY_TASK_IGNORE_RESULT=True`、沒有 result backend；而且「只能查自己的 job」本來就需要 task → owner 對應。`Job` 表同時給 owner scoping（IDOR → 404）、可查歷史、跨 worker 的取消旗標 |
| task 寫法 | ✅ | `@shared_task(name=...)` 疊 `@tracked_job`，函式第一個參數拿到 `JobHandle`：`job.progress(pct, msg)` 回報進度**同時是取消檢查點**；`raise JobFailed("code", "說明")` 給使用者看得懂的失敗（`error` = 錯誤碼）；其他例外一律 `error="internal_error"`，細節只在 log/Sentry。回傳值存進 `result`（要能 JSON 序列化） |
| 發起 | ✅ | `JobService.start(user, task, **primitive_kwargs)`：先建 `Job`（pending），commit 後 `apply_async(task_id=預先產生的 id)`；broker 不通 → job 直接 failed（`enqueue_failed`），不會永遠 pending |
| 取消 | ✅ | `POST /jobs/{id}/cancel`：pending → 立即 cancelled；running → 設 `cancel_requested_at`，task 在下一個檢查點停下（`cancel_requested=true` 直到那時）；另外 `control.revoke()` 讓還在佇列的訊息被丟掉（revoke 清單只存在 worker 記憶體，真正可靠的是 DB 旗標）。不用 `terminate=True`：強殺 process 會讓寫到一半的資料不一致 |
| 冪等 / worker 死掉 | ✅ | 認領是條件式 UPDATE（pending → running），重送會 skip；`started_at` 早於 `CELERY_TASK_TIME_LIMIT` 的 running 視為死掉的那次，允許重新認領 |
| 時間限制 | ⚠️ 沿用全域 | soft/hard 300s/360s。更長的工作拆小，或對該 task 個別放寬 `soft_time_limit`/`time_limit`（同時確認 `visibility_timeout` 仍大於它） |
| 清理 | ✅ | `jobs.purge_old_jobs` 每天刪結束超過 `JOB_RETENTION_DAYS`（預設 30）天的 job |
