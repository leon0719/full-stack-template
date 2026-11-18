# API 設計規範

這個 Django Ninja 專案在 API 設計上的慣例與現況，供新增/修改端點前對照。
✅ 已遵守／⚠️ 部分遵守／❌ 不採用（理由見備註，避免重複討論）。

| 項目 | 狀態 | 備註 |
|---|---|---|
| URL 版本前綴 `/api/v1/` | ⚠️ 未採用 | 本專案 router 掛在根路徑（`/auth`、`/articles`，`config/urls.py`），前端 `django-adapter.ts` 依此對接；要加版本前綴時前後端一起改 |
| 健康檢查不 versioned | ✅ | `/health/live`、`/health/ready` 留根路徑，Docker healthcheck、CI smoke test、`config/logging.py` 的 `HEALTH_CHECK_PATHS`、外部 uptime 監控都寫死這兩個路徑 |
| 資源複數名詞、禁動詞 | ✅ | `/articles`；`/auth/register` `/auth/login` 是認證流程的合理例外 |
| kebab-case 多字路徑 | ❌ 未驗證 | 目前都是單字資源，新增多字資源（如 `user-profiles`）時才適用 |
| HTTP 動詞語意 | ✅ | GET 無副作用、PATCH 部分更新（非 PUT，因無整包覆蓋需求）|
| 統一回應 envelope `BaseResponse` | ✅ | 團隊契約（與 FastAPI 模板、.NET 後端、前端 `shared/api` 相同）：成功 `{"data": <T>, "error": null}`，失敗 `{"data": null, "error": {"code": <HTTP 狀態碼>, "message": "...", "reason": "<ErrorCode>" \| null}}`。schema 在 `apps/core/schema.py`；端點宣告 `response=BaseResponse[XxxResponse]` 並 `return BaseResponse(data=...)`，刪除回 200 + `BaseResponse()`（不回 204）。`/` 與 `/health/*` 是探針，不包 envelope |
| 錯誤 `reason` 字串碼 | ✅ | `error.code` 是 HTTP 狀態碼（團隊契約）；`error.reason` 是穩定的機器可讀碼，讓 client 在同一狀態碼下分辨原因、當 i18n key，不必比對 `message`。由 `config/exceptions.py` 的 `error_body()` 集中產生（401/403/404/422/429/`AppError` 都帶 `reason`，例如 422 `export_too_large`、401 `invalid_signature`、409 `job_not_cancellable`、403 `csrf_failed`（cookie 認證的 unsafe 請求沒過 CSRF 檢查），見 `config/errors.py` 的 `ErrorCode`）。業務/領域錯誤（client 可能要分支處理）用 `AppError(status, code, message)`；基礎設施錯誤（malformed JSON、上游逾時/不可用，client 無從分支）維持 `HttpError`（`reason` 為 `null`），如 `config/ninja_config.py`、`config/external_api_handler.py` |
| RFC 9457（原 7807）Problem Details | ❌ 不採用 | 團隊契約是 `BaseResponse`；`reason` 已涵蓋 `type` 的「機器可讀錯誤種類」用途 |
| 驗證錯誤不回顯敏感輸入 | ✅ | 422 的 `message` 由 `_validation_message()` 組成 `欄位: 原因; ...`，只用 `loc`/`msg`，不含提交的值 |
| 第三方呼叫失敗不洩漏原始例外 | ✅ | `external_services.py` 走 `@handle_api_call(_graceful)` |
| Bearer Token，非 JWT | ✅ 刻意 | opaque token + SHA-256 digest，撤銷比 JWT 簡單 |
| 瀏覽器：HttpOnly cookie + CSRF | ✅ | `POST /auth/line/exchange` 把同一顆 opaque token 放進 `HttpOnly` cookie（名稱 `AUTH_COOKIE_NAME`，prod `__Host-auth`；`Secure`、`SameSite=Lax`、`Path=/`、不設 `Domain`；`max_age` = `AUTH_TOKEN_TTL_DAYS`），**回應 body 不含 token**，JS 讀不到；本身也驗 CSRF。cookie 會被瀏覽器自動帶上，所以 cookie 認證的 unsafe 請求（POST/PUT/PATCH/DELETE）必須帶 `X-CSRFToken`：先 `GET /auth/csrf` 取 token，沒過回 403 `csrf_failed`（token 失效時收到，重取再送一次；API 主機上有人走 Django `login()`（admin、allauth callback）會輪替 token，`csrftoken` cookie 過期也會失效。本專案自己的登入端點不會輪替）。`POST /auth/logout` 撤銷 token 並清 cookie。有 `Authorization` header 時只認 header、忽略 cookie（也不驗 CSRF）；沒 header 也沒 cookie → 401 `unauthenticated`。沒有簽發 token 給非瀏覽器用戶端的端點（測試用 `AuthService.issue_token`）。部署前提：前端與 API 必須同一主網域（same-site） |
| IDOR 防護 | ✅ | `get_owned_or_404()`，非 owner 回 404 不回 403（含 `/jobs/{id}`：只能查/取消自己發起的 job） |
| 角色權限（RBAC） | ✅ | `auth=require_role(Role.ADMIN)`（`apps/accounts/authentication.py`）取代該端點的 `BearerAuth()`：沒帶/無效 token → 401 `unauthenticated`，token 有效但缺角色 → 403 `permission_denied`。多個角色是 OR。`GET /auth/me` 回 `roles: ["admin", "user"]` 給前端 `usePermission` / `RequireRole`。角色只決定「能不能呼叫這支端點」，資料範圍仍要 owner scoping 或明確的管理查詢。範例：`GET /notifications/failed` |
| 檔案下載不包 envelope | ✅ 例外 | 成功時直接回檔案（`apps.core.exports.attachment_response`）：`Content-Disposition: attachment; filename="<ASCII 備援>"; filename*=UTF-8''<百分比編碼>`（RFC 6266/5987，中文檔名）、`Cache-Control: no-store`；**錯誤仍是 `BaseResponse` envelope**（例如列數超過 `EXPORT_MAX_ROWS` → 422 `export_too_large`）。用 `openapi_extra` 宣告 binary 回應。範例 `GET /articles/export?format=xlsx\|pdf\|zip`（同列表的篩選條件，`ExportThrottle` per-user 10/m）。前端用 `apiDownload()` |
| 長任務：建立 → 輪詢 → 取消 | ✅ | 超過幾秒的工作不在 request 內做：建立 `Job` 回 201 + job，client 輪詢 `GET /jobs/{id}`（`data` 的 `id/status/progress/result/error` 是與前端 `useJobPolling` 約定的形狀；`status` ∈ pending/running/succeeded/failed/cancelled，`progress` 0–100 或 null，`error` 是穩定錯誤碼或 null），`POST /jobs/{id}/cancel` 取消（已結束 → 409 `job_not_cancellable`）。寫法見 `apps/jobs/tasks.py` |
| Inbound webhook 驗簽 | ✅ | `POST /notifications/line/webhook`：不用 bearer token，以 `X-Line-Signature`（Messaging API channel secret 對**原始 body** 做 HMAC-SHA256、base64）+ `hmac.compare_digest` 驗證，失敗 401 `invalid_signature`、未設定 secret 503。別的服務的 webhook 照同樣模式：驗簽在 parse body 之前、不把 body 寫進 log |
| JSON 欄位 snake_case，非 camelCase | ✅ 刻意 | Python 生態原生 snake_case；除非前端框架強烈要求，不局部改 |
| Page-based pagination | ✅ | 不用 `@paginate`（它的輸出無法包進 envelope）：view 收 `page: StandardPagination.Input = Query(...)`，回 `BaseResponse(data=StandardPagination().paginate_queryset(qs, page, request))`，response 宣告 `BaseResponse[Page[XxxResponse]]` → `data: {items, count}`；`MAX_PAGE_SIZE` 上限 |
| Cursor pagination / Link header | ❌ 未引入 | 本專案只有 page-based（`StandardPagination`）。需要時照上游 `django-ninja-backend-template` 的 `GET /api/v1/articles/feed`：view 內呼叫 ninja `CursorPagination(...).paginate_queryset()`，schema `CursorPage[T]` 包進 `BaseResponse` |
| FilterSchema 篩選 | ✅ | 不用裸 `request.GET.get()` |
| AnonRateThrottle / WriteRateThrottle | ✅ | counter 存 Django cache |
| 429 `Retry-After` header | ✅ | `config/exceptions.py` 的 `Throttled` handler，用 `exc.wait`（向上取整為整數秒）設值；`wait()` 回 `None` 時不送這個 header |
| 伺服器端原子冪等 | ✅ | rows-affected UPDATE 認領一次性副作用，優於 client `Idempotency-Key` |
| CORS 白名單 + prod 強制驗證 | ✅ | `CORS_ALLOWED_ORIGINS` 走 `Settings`，prod 沒設會拒絕開機 |
| `CORS_ALLOW_CREDENTIALS=True` | ✅ 刻意 | 瀏覽器要帶 HttpOnly auth cookie 跨 origin 呼叫（前端與 API 是不同 origin）；配合白名單 `CORS_ALLOWED_ORIGINS`，**絕不**搭配 `CORS_ALLOW_ALL_ORIGINS`（`local.py` 維持 False）。`CSRF_TRUSTED_ORIGINS` 也自動併入 `CORS_ALLOWED_ORIGINS` |
| OpenAPI 自動產生 | ✅ | `/api/docs`；schema 要寫完整型別 + `Field(description=...)`。**prod 沒有這個路徑**（`docs_url` 只在 `DEBUG=True` 時開，`config/urls.py`），避免公開洩漏完整 API schema |
| 時間一律 ISO 8601 UTC | ✅ | `USE_TZ=True`，ruff `DTZ` 強制 |
| ETag / If-Match 樂觀鎖 | ❌ 暫不補 | 沒有明顯並發修改風險場景，需要時再加 |
| `X-Request-ID` 貫穿 log | ✅ | `config/middleware.py` 的 `RequestIDMiddleware`：產生/沿用 request id，綁進每一行 loguru log 跟 Sentry tag，回應也帶 `X-Request-ID` header——這點在早期版本的規範文件裡誤標成「未實作」，是文件沒跟上程式碼，不是功能缺口 |
| Cache-Control（唯讀端點快取） | ❌ 暫不補 | 沒有已知快取需求 |
| API 版本棄用政策 | ❌ 未定義 | 目前只有 `/api/v1`，沒有出過 v2，見下方「API 版本棄用政策（出 v2 時要做的事）」 |

## API 版本棄用政策（出 v2 時要做的事）

1. 公告周期：新版本上線後，舊版本至少繼續服務一段時間（建議 90 天起跳），公告期間不強制關閉。
2. Header 標示：回應加 `Deprecation`/`Sunset` header（RFC 8594）標示棄用日期，讓 client 端能自動偵測。
3. 公開公告：README/CHANGELOG 註明棄用時程，方便 client 端提前準備遷移。
4. 關閉前先看流量：靠 log/監控確認舊版本流量真的歸零，再動手關閉，不要憑感覺或時間到就關。

## 新增端點檢查清單

1. schema.py 型別 + description 完整
2. 業務錯誤用 `AppError(status, code, message)`，狀態碼符合語意
3. owner-scoped 查詢用 `get_owned_or_404()`
4. 寫入端點加 `WriteRateThrottle`；限特定角色的端點用 `auth=require_role(...)`
5. 列表端點視需要加 `FilterSchema` + 分頁
6. 一次性副作用用原子 claim，不用 client idempotency key
7. 業務寫入在同一個交易內 `record_audit()`；要通知使用者走 `NotificationService.enqueue_*`（outbox），不要在 request 內直接寄信/打 LINE
8. 測試涵蓋 `unit`/`integration`，含錯誤路徑
