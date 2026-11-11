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
- This project's adapter is `djangoAuthAdapter` (`shared/auth/adapter/django-adapter.ts`: LINE login →
  exchange code → token), set in `main.tsx` via `setAuthAdapter`. It unwraps the `BaseResponse` envelope
  itself — it cannot use the `shared/api` client (circular dependency).
- Prod fail-fast: under `import.meta.env.PROD`, `login/init` throw if the adapter is still `fakeAuthAdapter`.
- Token persistence belongs to the `AuthAdapter` (persist on login, clear on logout, `me` restores the
  session from the persisted token); the store keeps `state.token` in memory only. `tokenStorage` is an
  auth internal and not part of the public API.
- Security: the token lives in localStorage, so any XSS can steal it. For production prefer an httpOnly
  cookie issued by the backend, plus your own CSP / security headers (not built into the template).
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
- `Authorization: Bearer <token>` is attached only for the API origin (`VITE_API_BASE_URL`, same-origin
  when unset); an absolute URL to another host gets no token (prevents credential leaks).
- Non-2xx throws `ApiError` (`status` + `reason` + `message` + `payload`); a same-origin 401 clears the session.

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
