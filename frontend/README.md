# Frontend Platform Template

通用型 React 前端平台模板：Vite + React 19 + TS，FSD v2.1（pages-first），Biome 單一工具鏈，
內建可複用的權限、API client 與跨切面原件，讓新專案以低成本快速啟動。

## 技術棧

React 19 · TypeScript · Vite · TanStack Router · TanStack Query · Zustand ·
React Hook Form · Zod · Tailwind CSS v4 · Vitest · Testing Library · Biome

## 快速開始

```bash
bun install
bun run dev
```

示範登入帳號：`admin/admin`（管理者，roles: admin+user）、`user/user`（一般使用者，role: user）。

## 指令

| 指令 | 說明 |
| --- | --- |
| `bun run dev` | 開發伺服器 |
| `bun run build` | 型別檢查 + 打包 |
| `bun run format` | Biome 格式化 + 修正 + 整理 import |
| `bun run lint` | Biome 靜態檢查 |
| `bun run type-check` | `tsc --noEmit` |
| `bun run test` | Vitest |

## 目錄結構（FSD）

```
src/
  app/      進入點（entrypoint：providers 組裝）、router
  pages/    頁面 slice（ui / api / model）
  shared/   共用底層
    auth/   權限：store、adapter、hooks、guards
    api/    API client + 攔截器
    ui/     Button / Input / AppLayout / ErrorBoundary
    lib/    cn、useZodForm、query-client
    config/ env（zod 驗證）
```

分層鐵律與下沉時機見 `CLAUDE.md`。

> **FSD 偏離說明**：`shared/auth` 並非 `entities/`，因為它同時被 `app`（router guard）與
> `shared/api`（cookie / 401 處理）消費；放最底層才能讓「只能上層 import 下層」的鐵律成立。

## 起一個新專案

1. 以本 repo 為模板建立新 repo。
2. 設定 `.env` 的 `VITE_API_BASE_URL`。
3. 實作專案的 `AuthAdapter` 並 `setAuthAdapter(...)`（見下節）。
4. 用 `scaffold-page` 加頁面，於 `src/app/router.tsx` 註冊路由。

## 接真實後端（取代 fake adapter）

登入憑證是後端種的 HttpOnly cookie，前端不碰也不存任何 token：`completeLineLogin(code)` 回傳 `User`（後端以 Set-Cookie 發憑證），`logout` 呼叫後端清 cookie，`me` 打後端（瀏覽器自動帶 cookie）、未登入回 `null`。
API origin 的請求由 `shared/api` 自動帶 `credentials: "include"`，寫入請求另外帶 `X-CSRFToken`（細節見 `docs/platform.md`）。本專案的實作見 `src/shared/auth/adapter/django-adapter.ts`。

```ts
import { type AuthAdapter, setAuthAdapter, type User } from "@/shared/auth";
import { apiGet, apiPost } from "@/shared/api";

const realAdapter: AuthAdapter = {
  getLineLoginUrl: () => "https://api.example.com/accounts/line/login/?process=login", // 整頁導轉
  completeLineLogin: async (code) => {
    await apiPost("/auth/line/exchange", { code }); // 後端以 Set-Cookie 發憑證，body 不含 token
    return apiGet<User>("/auth/me"); // 後端欄位要自己對應成前端 User（本專案見 django-adapter.ts 的 toUser）
  },
  logout: async () => {
    await apiPost("/auth/logout"); // 後端清 cookie
  },
  me: () => apiGet<User>("/auth/me").catch(() => null), // 401 = 未登入
};
setAuthAdapter(realAdapter); // 在 app 啟動時呼叫一次
```

## 權限用法

```tsx
const { hasRole } = usePermission();
<RequireRole role="admin"> ... </RequireRole>
// 路由硬守衛：createRoute({ beforeLoad: () => { ... throw redirect({ to: "/login" }) } })
```

## i18n（多語）
支援 `zh-TW`（預設）與 `en`，語言偏好存於 localStorage（`app.lang`）。

```tsx
import { useTranslation } from "react-i18next";
const { t } = useTranslation();
<h1>{t("auth.login.title")}</h1>
```

切換語言：header 的 `<LanguageSwitcher />`，或 `i18n.changeLanguage("en")`。

新增語言：於 `src/shared/i18n/config.ts` 的 `SUPPORTED_LANGUAGES` 與 `resources` 註冊，並新增 `src/shared/i18n/locales/<code>.json`。詞庫 key 以 `zh-TW.json` 為型別來源。

## 錯誤追蹤與告警

在 `.env`（或部署時的建置環境）填入 `VITE_SENTRY_DSN` 即啟用：

```bash
VITE_SENTRY_DSN=https://<public-key>@<org>.ingest.sentry.io/<project-id>
```

啟用後這三條路徑都會送進 Sentry：

- `reportError(error, context?)` 的所有呼叫
- `<ErrorBoundary>` 接住的 render 錯誤
- `window` 層級的 `error` / `unhandledrejection`（`installGlobalErrorReporting`）

留空則完全不啟用（`initErrorTracking()` 直接 return），reporter 維持預設的
`console.error`——本機開發不需要接 Sentry。

> DSN 會被打包進 bundle，這是預期的：Sentry DSN 設計上就是可公開的**寫入**端點，
> 無法用來讀取專案資料。但 Sentry 的 **auth token** 絕不可放進 `VITE_` 變數。

build 會產生 `hidden` sourcemap（`dist/assets/*.map`，不對瀏覽器曝光），
上傳到 Sentry 後才能看到還原後的 stack trace。

**填了 DSN 只做到「錯誤被記錄」。** 要讓錯誤真的通知到人，還得在 Sentry
建 alert rule 接 Slack——步驟見[`backend/docs/alerting.md`](../backend/docs/alerting.md)。

### CI 失敗通知

`main` 分支 CI 失敗時會發 Slack，需設定 repo secret `SLACK_WEBHOOK_URL`
（*Settings* → *Secrets and variables* → *Actions*）。未設定時 CI 會印一則
warning 說明通知未啟用，但不會讓 CI 變紅。

## 已知限制 / Known Limitations

冷載入 / 硬重新整理 / 直接深連結到受保護路由（如 `/admin`）時，路由的同步 `beforeLoad`
會在 `useAuthStore.init()`（於 mount useEffect 非同步執行）恢復 session 之前就執行，
導致已登入使用者被踢回 `/login`，再次導航即可正常進入。此行為偏保守（不讓未驗證狀態通過），
後續改善方向為讓 `beforeLoad` await 一個 session-ready promise。

## 開發規範

TDD（RED→GREEN→REFACTOR）；提交前 `bun run lint && bun run type-check && bun run test` 全綠。
