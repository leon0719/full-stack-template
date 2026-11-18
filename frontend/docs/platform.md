# Platform primitives (`src/shared`)

Read this before changing `shared/auth`, `shared/api`, `shared/i18n`, or the error-handling primitives.
Everyday usage rules are in `CLAUDE.md`; this file covers the internals and the reasons behind them.

## Auth / permissions (`shared/auth`)

- `useAuth()` → `{ user, status, isAuthenticated, login, logout }`
- `usePermission()` → `{ hasRole(role), hasAnyRole(roles) }` (role-based RBAC)
- Guards: `<RequireAuth>` (redirects to `/login`), `<RequireRole role>` (renders 403)
- Hard route guard: in `createRoute`'s `beforeLoad`, first `await initAuth()` (the session-ready promise —
  cold loads and deep links wait for session restore), then check `useAuthStore.getState().status` and
  `throw redirect(...)`.
- `AuthAdapter` = `{ getLineLoginUrl(): string; completeLineLogin(code): Promise<User>; logout(): Promise<void>;
  me(): Promise<User | null> }` (`setAuthAdapter(yourAdapter)`; store, guards, and interceptors stay untouched).
  There is no password login: sign-in is LINE only.
- This project's adapter is `djangoAuthAdapter` (`shared/auth/adapter/django-adapter.ts`: LINE login →
  exchange code → HttpOnly cookie → `GET /auth/me`), set in `main.tsx` via `setAuthAdapter`. It uses raw
  `fetch` and unwraps the `BaseResponse` envelope itself (the `shared/api` client clears the auth store on any
  401, which login must decide for itself), but its writes (`POST /auth/line/exchange`, `POST /auth/logout`) go
  through `fetchWithCsrf` from `@/shared/api` — the same credentials + `X-CSRFToken` + retry-once-on-`csrf_failed`
  policy `apiPost` uses, returning the raw `Response` without `settle()`. `logout()` throws on any non-OK
  response (network, 5xx, `csrf_failed` after the one retry) so the store never claims "logged out" while the
  cookie is still alive; the one exception is 401, where the session is already gone. The adapter imports
  `@/shared/api`, so `shared/auth` ↔ `shared/api` is a runtime import cycle; it is safe because neither side
  calls the other at module load, only inside functions — keep it that way.
- Prod fail-fast: under `import.meta.env.PROD`, `completeLineLogin/init` throw if the adapter is still `fakeAuthAdapter`.
- No token in the browser: the session is an HttpOnly cookie set by the backend on `POST /auth/line/exchange`
  (the response body is `{"data": null}`) and cleared by `POST /auth/logout`, so JavaScript can't read it and an
  XSS can't steal it. The store holds only `user` / `status` in memory; `me()` restores the session by calling
  the backend (cookie sent automatically) and `null` means logged out. Nothing credential-like goes into
  localStorage. Only the template's `fakeAuthAdapter` remembers the logged-in account *name*
  (`localStorage["auth.fake-user"]`) so a refresh keeps the demo session; it is not a credential and the
  adapter fails fast in prod.
- Security: a cookie makes CSRF the browser-side risk, so every unsafe request to the API origin also sends
  `X-CSRFToken` (see API client below); the cookie is `SameSite=Lax`. A CSP `<meta>` is injected at build time
  (`cspMeta` in `vite.config.ts`; `connect-src` comes from `VITE_API_BASE_URL` / `VITE_SENTRY_DSN` — add any
  new third-party origin there). HSTS / `X-Frame-Options` / `nosniff` must come from the host as response
  headers (meta can't set them). Cross-origin deployments need the backend to allow credentials
  (`CORS_ALLOW_CREDENTIALS`) and trust the frontend origin for CSRF (`CSRF_TRUSTED_ORIGINS`, which includes
  `CORS_ALLOWED_ORIGINS`).
- Fake accounts (template demo, fail-fast in prod): LINE codes `fake-code-admin` (admin + user roles) and
  `fake-code-user` (user role); the demo login link uses the latter.
- Frontend guards (`beforeLoad` / `RequireRole`) are UX only, not an authorization boundary; the backend
  must authorize independently.

> FSD deviation: permissions live in `shared/auth`, not `entities/`, because both `app` (router guard) and
> `shared/api` (interceptor) consume them; only the bottom layer keeps the "upper imports lower" rule intact.

## API client (`shared/api`)

- `apiGet/apiPost/apiPut/apiPatch/apiDelete<T>(path, body?, init?)`; partial updates use `apiPatch`
  (backend update endpoints are PATCH).
- Backend contract `BaseResponse` (same for the Django Ninja / FastAPI / .NET templates): success
  `{ data, error: null }`, failure `{ data: null, error: { code: <HTTP status>, message, reason } }`.
  The client unwraps `data` for responses from our own API, so `T` is the inner type.
- Cookie auth, API origin only (`VITE_API_BASE_URL`, same-origin when unset): requests to it use
  `credentials: "include"`; an absolute URL to another host gets neither the cookie nor CSRF (prevents
  credential leaks). There is no `Authorization` header.
- CSRF: unsafe methods (POST/PUT/PATCH/DELETE) to the API origin send `X-CSRFToken`. `getCsrfToken()` fetches
  `GET /auth/csrf` (`CSRF_PATH`, `credentials: "include"`, reads `data.csrf_token`; this also sets the
  `csrftoken` cookie) once and caches the promise in memory; a failed fetch is not cached and surfaces as
  `ApiError` (or `TypeError` on a network failure) before the write is sent. A 403 with
  `reason: "csrf_failed"` (stale token: rotated by a Django `login()` on the API host such as the admin or the allauth callback, or an expired `csrftoken` cookie) → `resetCsrfToken()`, refetch, and retry
  **exactly once**; a second `csrf_failed` throws `ApiError`. The backend checks CSRF before the session, so
  an expired/revoked cookie on a write shows up as `csrf_failed` first, then 401 on the retry (store cleared,
  no more retries). The credentials + CSRF + retry-once policy lives in one place, `fetchWithCsrf()` (exported;
  returns the raw `Response`, no `settle()`), which `apiGet/apiPost/...` and the auth adapter share.
  `apiUpload` (XHR) sends the same headers + `withCredentials` but does not retry; it only drops the cached
  token so the next call refetches.
- Non-2xx throws `ApiError` (`status` + `reason` + `message` + `payload`); a same-origin 401 clears the session.

### 上傳 / 下載 / 長任務 / SSE（皆從 `@/shared/api` 匯入）

- **FormData 上傳**：`apiPost(path, formData)`。body 是 `FormData` / `Blob` / `URLSearchParams` / `ArrayBuffer`
  時原樣送出、不設 `Content-Type`（multipart boundary 交給瀏覽器）；其他值才 `JSON.stringify` 並標 JSON。
- **上傳進度**：`apiUpload<T>(path, formData, { onProgress, signal, method })`，XHR 實作。fetch 沒有上傳進度事件
  （串流 request body 需 `duplex: "half"` + HTTP/2，Safari / Firefox 不支援），所以只有這一支走 XHR；cookie + CSRF header、
  `ApiError`、401 清 session、envelope 解包規則與 `apiPost` 共用 `client.ts` 的 `settle()`（不自動重送 `csrf_failed`）。取消用
  `AbortController`，reject `AbortError`；網路錯誤 reject `TypeError`（與 fetch 一致）。
- **下載匯出檔**：`apiDownload(path, { method?, body? })` → `{ blob, filename }`，再 `downloadBlob(blob, filename ?? "預設.xlsx")`
  （`@/shared/lib`）。檔名由 `parseContentDispositionFilename` 解析，優先 `filename*=UTF-8''…`（RFC 5987，中文檔名），
  其次 `filename="…"`，並去掉路徑片段。後端要記得 `Access-Control-Expose-Headers: Content-Disposition`
  （跨網域時瀏覽器預設讀不到這個 header）——本 repo 後端已設 `CORS_EXPOSE_HEADERS`，範例端點
  `GET /articles/export?format=xlsx|pdf|zip`。
- **長任務輪詢**：`useJobPolling<TResult>(jobId, { intervalMs, basePath, onSettled, fetchJob, cancelJob })`。
  後端契約：`GET /jobs/{id}` 回 `Job { id, status, progress, result, error }`（本 repo 後端 `apps/jobs` 已實作，
  `id` 是數字，所以 `JobId = string | number`；示範用 `POST /jobs/demo`）（status 為
  `pending | running | succeeded | failed | cancelled`，後三者為終態）、`POST /jobs/{id}/cancel`。
  到終態或查詢失敗即停止 `refetchInterval`；`onSettled` 每個 job 只呼叫一次；`cancel()` 後立即重抓，
  之後照輪詢等後端進入 `cancelled`。端點不同時用 `basePath` 或 `fetchJob` / `cancelJob` 覆寫。
- **SSE**：`useEventStream({ path, invalidate, onMessage, getStreamToken, params, enabled, heartbeatTimeoutMs })`
  回傳 `"idle" | "connecting" | "open" | "reconnecting"`。
  > ⚠️ **本 repo 的後端目前沒有 SSE 端點，也沒有 stream token 端點**（上游 django-ninja 範本的 `apps/realtime`、
  > `POST /auth/stream-token` 沒有同步過來）。hook 是通用 primitive，先放著；要用時後端補 SSE + stream token
  > （規則見 `backend/docs/integration-standards.md` 的 SSE 段落），demo 頁的 SSE 區塊預設不連線。
  - 事件名稱 → query key：SSE 的 `event:` 名稱，或預設 `message` 事件中 JSON 的 `type` 欄位
    （django-ninja 範本的 `/api/v1/realtime/sse` 送的是後者）。同一時間窗（`batchMs`，預設 300ms）的
    invalidate 會合併去重。
  - 斷線一律關掉、自己重連：指數退避 3s→60s × jitter 0.5–1（`reconnectDelay`），連上歸零；重新連上時預設
    把 `invalidate` 裡全部 key 重抓一次（斷線期間漏掉的推播補不回來）。
  - 認證（預設）：EventSource 不能帶 header，token 只能放 query string，而 URL 會進瀏覽器歷史與 proxy log，
    **不要放長效 access token**。後端提供短效、只能開 stream 的 token，前端以 `getStreamToken` 每次（重）連前取一顆
    （例：`apiPost("/auth/stream-token")`，這個請求本身走 cookie + CSRF，由 `apiPost` 自動處理）。本 repo 的後端
    目前沒有 SSE / stream token 端點，補上時照這個預設做。
  - 替代做法：傳 `withCredentials: true` 且不給 `getStreamToken`，讓瀏覽器直接帶 HttpOnly cookie（跨網域另需後端
    CORS 允許 credentials）。**只有後端的 SSE 端點也接受認證 cookie 時才可行**，要先確認，否則用 stream token。
  - callback / `invalidate` 對照表放 ref，inline 物件不會造成重連；`path`、`params`、`enabled`、事件名稱集合變了才重連。

## Error handling (`shared/lib` + `shared/ui`)

- `reportError(error, context?)` / `setErrorReporter(fn)`: pluggable error reporting. To wire Sentry or
  similar, call `setErrorReporter` once at startup; `main.tsx` already hooks window `error` /
  `unhandledrejection`.
- `<ErrorBoundary>` (`shared/ui`) wraps `RouterProvider`, catches render errors, has a retry button, and
  routes caught errors through `reportError`.
- The build emits `hidden` sourcemaps (`dist/assets/*.map`, not exposed to browsers, for upload to an
  error-tracking service).

## Other primitives

- `<AppLayout>` (`shared/ui`): header (current user + logout) + `<Outlet />`
- `useZodForm(schema, options?)` (`shared/lib`): thin RHF + zod wrapper

## UI 元件（`shared/ui`）

- **`confirmDialog(options) → Promise<boolean>`**：取代 `window.confirm`，可在事件處理器 / mutation callback 直接
  `await`。原生 `<dialog>` + `showModal()`：focus trap（頁面其他部分 inert）、Esc（cancel 事件）、點背景都算取消；
  `danger: true` 時確認鈕為警示色、初始焦點在「取消」；關閉後焦點回到開啟前的元素。同時只會有一個，新的請求會把舊的當取消。
  掛載點 `<ConfirmDialogHost />` 在 `app/entrypoint.tsx`；沒掛時退回 `window.confirm`（單獨 render 頁面的測試不會卡住）。
- **`toast(message, { tone, duration })` / `toast.success|error|info`**：自製而非 sonner——需求只有文字 + 自動消失 +
  關閉鈕，自己寫約 120 行、零依賴、樣式直接用 theme token、文案走 i18n；需要 promise toast、滑動關閉等再換 sonner。
  不是 hook，React 外也能呼叫。預設 4 秒、錯誤 6 秒、`duration: 0` 常駐，最多同時 3 則（丟最舊）。
  live region（`role="status"`, polite）先存在於 DOM 才放入文字，螢幕閱讀器才會念。掛載點 `<Toaster />` 在
  `app/entrypoint.tsx`；沒掛時為 no-op。需要使用者決定的事用 `confirmDialog`，不要用 toast。
- **`<Field label htmlFor error hint required>`**：label + 控制項 + 提示 / 錯誤，自動把 `aria-invalid`、
  `aria-describedby` 接到唯一的子元素（子元素自己給的優先）。`error` 直接傳 RHF 的 `errors.x`：其 message 視為 i18n key
  並 `t()`；傳字串則原樣顯示。
- **`<FileDropzone onFiles accept maxSize multiple maxFiles>`**：拖放 + 點選。整塊是 `<button>`（Tab / Enter / Space），
  `accept` 寫法同 `<input accept>`（拖放不受 accept 限制，所以會再用 `matchesAccept` 檢查一次）；格式、大小、數量錯誤
  以 `role="alert"` 列出，合格的檔案照樣送出。可放進 `<Field htmlFor={id}>`。只負責選檔，上傳用 `apiPost` / `apiUpload`。
- **`<EmptyState>` / `<ErrorState onRetry>`**：無資料 / 載入失敗版面，標題預設用通用文案；`ErrorState` 是 `role="alert"`。
  description 不要直接放 `ApiError.message`，用 `reason` 對 i18n key。
- **`<PageHeader title description actions backTo>`**：h1 + 動作列，並設定分頁標題 `標題 · App`（離開時還原）。
  `backTo` 有上一頁時走 `history.back()`（保留列表篩選與捲動），直接進來時才走連結。
- **`<Badge tone>`**（neutral / info / success / warning / danger）、**`<Spinner label?>`**（`label=""` 為純裝飾）。
  狀態色 token（`--color-success|warning|info`）在 `src/index.css`。

## 檔案與時間工具（`shared/lib`）

- `compressImage(file, { maxEdge = 2000, quality = 0.85, skipBelow = 1MB, type = "image/jpeg" })`：canvas 縮圖重新編碼。
  非圖片、GIF / SVG、小檔、解不開（非 Safari 的 HEIC）、壓完沒變小一律回傳原檔，不丟錯。重新編碼會去掉 EXIF（含 GPS）。
- `validateColumns(file, required) → { valid, headers, missing }` / `readSpreadsheetHeaders(file)`：上傳前檢查標題列。
  - CSV：只讀前 64KB，UTF-8 嚴格解碼失敗時改用 Big5（繁中 Windows 的 Excel「CSV」預設 CP950），支援引號、`""`、BOM。
  - XLSX：`read-excel-file`（`/browser`）**動態 import**，`vite.config.ts` 把它與依賴拆成獨立的 `spreadsheet` chunk
    （否則會被併進 vendor，首頁就整包下載）。它在瀏覽器用 Web Worker（blob URL）解壓縮，若有 CSP 要允許 `worker-src blob:`。
  - **不要用 npm 的 `xlsx`**（停在 0.18.5、有已知漏洞）。`.xls` 與其他格式丟 `SpreadsheetError("unsupportedFormat")`，
    解析失敗丟 `"unreadable"`；`reason` 可當 i18n key `common.spreadsheet.<reason>`。
- `downloadBlob(blob, filename)`、`parseContentDispositionFilename(header)`：見上方 `apiDownload`。
- `formatFileSize(bytes)`、`matchesAccept(file, accept)`。
- 時間：`formatDateTime(v, { withSeconds?, locale?, timeZone? })`、`formatDate(v)`、`formatRelativeTime(v, { now? })`。
  固定以 `Asia/Taipei`（`DISPLAY_TIME_ZONE`）顯示，不跟使用者電腦時區；語系預設取目前 i18n 語言（zh-TW「2026/11/13 14:05」、
  en「11/13/2026, 14:05」），相對時間用 `Intl.RelativeTimeFormat`（不需要 i18n key），超過 30 天改顯示日期。
  null / 無效值回空字串。在元件 render 中呼叫即可（`useTranslation` 會在切換語言時重繪）。
- 404: `createRouter`'s `defaultNotFoundComponent`; tests build a router with `createAppRouter({ history })`

## i18n (`shared/i18n`)

- Languages: `zh-TW` (default + fallback), `en`; detection order localStorage (`app.lang`) → navigator.
- Adding a language: add an entry to `SUPPORTED_LANGUAGES`, create `locales/<code>.json`, register it in
  `resources` in `config.ts`.
- Adding a key: add it to `locales/zh-TW.json` first (zh-TW is the type source, keys become typed
  automatically), then fill in the other languages.
- Type safety: `i18next.d.ts` declaration-merges `CustomTypeOptions` from the zh-TW resources; an unknown
  key is a compile error.
- zod messages: a schema's message is an i18n key (e.g. `"auth.login.usernameRequired"`), rendered with
  `t(errors.x.message)`.
- ErrorBoundary exception: it sits outside `I18nextProvider`, so it uses the global `i18n.t(...)` instead
  of the `useTranslation` hook.
