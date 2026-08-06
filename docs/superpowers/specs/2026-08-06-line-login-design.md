# LINE Login 專屬登入系統設計

日期：2026-08-06

## 背景與目標

目前 `apps/accounts` 用自訂的 opaque bearer token（`AuthToken` + `BearerAuth`）搭配帳號密碼登入。本次改動：

- 登入方式改為**只有 LINE Login**，移除帳號密碼登入。
- 未登入時，除了登入相關頁面，其餘頁面一律自動導向 `/login`。
- 新增獨立的登出頁面 `/logout`。
- 後端用 `django-allauth` 處理與 LINE 的 OAuth 交換，登入後把使用者的頭像、顯示名稱存下來，並透過既有 API 風格回傳給前端。
- 本地測試用 `cloudflared` quick tunnel 取得公開 HTTPS URL 供 LINE callback 使用。

## 架構總覽

後端只借用 `django-allauth` 的 `socialaccount` + LINE provider 處理「向 LINE 交換 profile」這件事，**不採用 allauth 的 headless session 機制**，避免和既有的 opaque bearer token 系統並存出兩套認證邏輯。

流程：

1. 前端「使用 LINE 登入」是一個真實的 `<a href>` 連結，指到 allauth 的 `/accounts/line/login/?process=login`（整頁導轉，不是 fetch，因為要離開 SPA 網域去 LINE 授權頁）。
2. LINE 授權完成後導回 allauth 的 callback（`/accounts/line/login/callback/`），allauth 完成 OAuth code 交換,取得 LINE profile。
3. 自訂的 `SocialAccountAdapter`（`apps/accounts/adapters.py`）介入：
   - 若找不到對應的 `LineProfile` → 建立新 `User`（`username=uuid4()`，無 email/密碼）+ 新 `LineProfile`；若已存在 → 用最新資料覆寫 `display_name`/`picture_url`。
   - 呼叫既有 `AuthService.issue_token()` 簽發 opaque bearer token（與帳密登入時期完全相同的 token 機制,不重造輪子）。
   - 產生一個**一次性、短 TTL（60 秒）的 exchange code**（存進 Django cache/Redis,對應剛簽發的 token),而不是把 token 直接放進 redirect URL——避免 token 經由 Referer header 或瀏覽器紀錄外洩。
   - 302 導回前端：`{FRONTEND_BASE_URL}/login/callback?code=<exchange_code>`。
4. 前端 `/login/callback` 頁面讀出 `code`,呼叫新增的 `POST /auth/line/exchange {code}`,消費該一次性 code,換回既有的 `TokenResponse {token}`。拿到 token 後沿用既有「存 token → 呼叫 `GET /auth/me`」流程,取得使用者資料（含頭像、顯示名稱）存進 store。

移除:`POST /auth/register`、`POST /auth/login`（帳密）與對應的 `schema.py`/`services.py`/`views.py` 程式碼、測試。`AuthToken`、`BearerAuth`、`GET /auth/me`、`POST /auth/logout` 維持不變,繼續作為 API 認證的唯一機制。

## 資料模型

新增 `apps/accounts/models.py::LineProfile`:

```python
class LineProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="line_profile")
    line_user_id = models.CharField(max_length=64, unique=True)
    display_name = models.CharField(max_length=255)
    picture_url = models.URLField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)
```

- 不新增自訂 `AUTH_USER_MODEL`,沿用 Django 內建 `User`,以 `OneToOneField` 關聯,與既有 `AuthToken` 的關聯式設計一致。
- `picture_url` 直接存 LINE 提供的圖片網址,不下載轉存。
- `display_name`/`picture_url` 每次登入都用 LINE 回傳的最新值覆寫。
- `User.username` 用 `uuid4()` 產生,確保唯一且與 LINE 顯示名稱（可變動,不適合當 username)完全解耦。
- 需在 `apps/accounts/admin.py` 註冊 `LineProfile`（唯讀 `updated_at`,可依 `register-admin` skill 慣例處理)。

## 後端 API 異動

### Schema（`schema.py`）

- 刪除 `RegisterRequest`、`LoginRequest`。
- `MeResponse` 擴充為 `{id, username, email, display_name, picture_url}`（後兩者在無 `LineProfile` 時為 `None`,保留彈性)。
- 新增 `LineExchangeRequest{code: str}`,沿用既有 `TokenResponse{token}`。

### Endpoints（`views.py`,router 仍掛在 `/auth`）

- 刪除 `POST /auth/register`、`POST /auth/login`。
- 新增 `POST /auth/line/exchange`（帶 `LineExchangeRequest`,沿用既有 `LoginThrottle` 節流規則,以 IP 為單位)。
- `GET /auth/me`、`POST /auth/logout` 簽章不變,`/auth/me` 回傳內容依上述擴充。
- allauth 自身的 `/accounts/line/login/`、`/accounts/line/login/callback/` 掛在 `config/urls.py`(只 include `allauth.socialaccount` + LINE provider 需要的 urls,不需要 `allauth.account` 的一般帳密頁面)。

### Settings（`config/settings/base.py` + env)

- `INSTALLED_APPS` 新增:`django.contrib.sites`、`allauth`、`allauth.socialaccount`、`allauth.socialaccount.providers.line`;`SITE_ID = 1`。
- `SOCIALACCOUNT_ADAPTER = "apps.accounts.adapters.LineSocialAccountAdapter"`。
- `SOCIALACCOUNT_PROVIDERS = {"line": {"APP": {"client_id": env("LINE_LOGIN_CHANNEL_ID"), "secret": env("LINE_LOGIN_CHANNEL_SECRET")}, "SCOPE": ["profile", "openid"]}}`(不需要 `email` scope)。
- 新 env 變數:`LINE_LOGIN_CHANNEL_ID`、`LINE_LOGIN_CHANNEL_SECRET`、`FRONTEND_BASE_URL`(組 redirect 用)。
- `prod.py` 的 `_validate_prod()` 新增一條:拒絕空的 `LINE_LOGIN_CHANNEL_ID`/`LINE_LOGIN_CHANNEL_SECRET`,比照既有 `SECRET_KEY`/`SENTRY_DSN` 檢查方式。

## 前端設計

### `shared/auth` 調整

- `model/types.ts`:`AuthAdapter` 拿掉 `login(credentials)`(帳密表單形狀不再適用),改為:
  ```ts
  interface AuthAdapter {
    getLineLoginUrl(): string;
    completeLineLogin(code: string): Promise<AuthSession>;
    logout(): Promise<void>;
    me(): Promise<AuthSession | null>;
  }
  ```
  `User` 型別新增 `displayName?: string`、`pictureUrl?: string`。
- `adapter/django-adapter.ts`:
  - `getLineLoginUrl()` 回傳 `${env.apiBaseUrl}/accounts/line/login/?process=login`。
  - `completeLineLogin(code)` 呼叫 `POST /auth/line/exchange`,拿到 token 後沿用既有「存 token(`tokenStorage.set`)→ 呼叫 `/auth/me`」流程。
  - `toUser()` 補上 `displayName`/`pictureUrl` 對映,`roles` 仍固定 `["user"]`(RBAC 擴充點不變)。
- `adapter/fake-adapter.ts`:同步補上假資料(固定 displayName/pictureUrl),供本地 demo 使用。
- `lib/use-auth.ts`:暴露介面同步調整(拿掉 `login`,加上 `getLineLoginUrl`/`completeLineLogin`)。

### Pages

- `pages/login`:表單整個換成一個「使用 LINE 登入」按鈕,是 `<a href={getLineLoginUrl()}>`(真實整頁導轉)。
- 新增 `pages/login-callback`(route `/login/callback`):`useEffect` 讀取網址上的 `?code=`,呼叫 `completeLineLogin(code)`,成功後導到 `/`;失敗則顯示錯誤訊息 + 回登入頁連結。
- 新增 `pages/logout`(route `/logout`):掛載時呼叫 `useAuth().logout()`,完成後顯示「已登出」+ 回登入頁按鈕。`AppLayout` 原本的登出按鈕改成導到 `/logout`(而非直接呼叫 API),使其成為真正獨立的頁面。

### 路由守衛(`app/router.tsx`)

- 目前只有 `/admin` 做保護。改成**預設全站需要登入**:在 root layout route 的 `beforeLoad` 統一做「`await initAuth()` → 未登入就 `throw redirect({to: "/login"})`」,白名單排除 `/login` 與 `/login/callback`。
- `/login` 維持「已登入就導回 `/`」的既有邏輯不變。
- `/admin` 原本的角色守衛(`RequireRole`/`beforeLoad` 角色檢查)不受影響,疊加在全站登入守衛之上。

## 本地測試(cloudflared Quick Tunnel)

因為 LINE Login callback 需要公開 HTTPS URL,本地開發流程:

1. 啟動後端:`make up`(Docker,port 8000)。
2. 啟動 tunnel:`cloudflared tunnel --url http://localhost:8000`,取得隨機 `https://xxxx.trycloudflare.com`。
3. 設定 Django:`backend/.env.local` 暫時把該 tunnel hostname 加進 `ALLOWED_HOSTS`;確認 dev 設定有正確處理 cloudflared 轉送的 `X-Forwarded-*`(`USE_X_FORWARDED_HOST`/`SECURE_PROXY_SSL_HEADER`),比照 prod Caddy 已有的機制。
4. LINE Developers Console:把該 Channel 的 Callback URL 暫時改成 `https://xxxx.trycloudflare.com/accounts/line/login/callback/`。
5. 前端維持本機執行(`bun run dev`,5173),但 `.env.local` 設 `VITE_API_BASE_URL=https://xxxx.trycloudflare.com`(前端登入連結、`/auth/me` 等都要打同一個有效公開網域,純本機 `localhost:8000` 在這個流程中不會被瀏覽器打到)。
6. 因為 quick tunnel 每次啟動網址都會變,重啟後需要重複步驟 3、4、5 的網址替換。

這段會寫進 `docs/development.md` 新增的「LINE 登入本地測試」章節,附上明確的手動步驟 checklist(不額外寫 helper script)。

## 影響範圍摘要

**後端**:
- `apps/accounts/models.py`(新增 `LineProfile`)、`admin.py`(註冊)、`adapters.py`(新增 `LineSocialAccountAdapter`)、`schema.py`(增刪)、`services.py`(刪帳密邏輯,新增 exchange-code 的簽發/消費邏輯,使用 Django cache 存放 code→user 對應)、`views.py`(增刪 endpoint)
- `config/settings/base.py`/`local.py`/`prod.py`(allauth 設定、新 env、prod 驗證)、`config/urls.py`(掛 allauth urls)
- 對應的 migration、單元/整合測試更新(移除帳密測試,新增 LINE 流程測試——`SocialAccountAdapter`/exchange endpoint 的測試需要 mock LINE 的 OAuth 回應)
- `backend/.env.local.example`、`docs/development.md`、`backend/docs/local-development.md` 補文件

**前端**:
- `shared/auth/model/types.ts`、`adapter/django-adapter.ts`、`adapter/fake-adapter.ts`、`lib/use-auth.ts`
- `pages/login`(改寫)、`pages/login-callback`(新增)、`pages/logout`(新增)
- `app/router.tsx`(全站登入守衛)
- 對應測試更新/新增

## 明確排除範圍(YAGNI)

- 不採用 django-allauth 的 headless session/token 機制,不引入第二套認證系統。
- 不新增自訂 `AUTH_USER_MODEL`。
- 不下載/轉存 LINE 頭像圖片到自己的儲存空間,只存 URL。
- 不寫自動化 tunnel helper script,只寫文件說明手動步驟。
- 不處理「LINE 帳號解除綁定」「多社群登入並存」等超出本次需求的情境。
