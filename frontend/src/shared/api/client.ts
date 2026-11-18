import { useAuthStore } from "@/shared/auth";
import { env } from "@/shared/config";
import { parseContentDispositionFilename } from "@/shared/lib";

// 團隊後端契約(Django Ninja / FastAPI / .NET 相同):
// 成功 { data: T, error: null };失敗 { data: null, error: { code: <HTTP 狀態碼>, message, reason } }
interface BaseResponse {
  data: unknown;
  error: { code: number; message: string; reason?: string | null } | null;
}

function isBaseResponse(payload: unknown): payload is BaseResponse {
  return !!payload && typeof payload === "object" && "data" in payload && "error" in payload;
}

export class ApiError extends Error {
  readonly status: number;
  /** 後端穩定的機器可讀錯誤碼(如 "username_taken");要分辨錯誤原因或當 i18n key 時用它,不要比對 message */
  readonly reason: string | null;
  readonly payload: unknown;
  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.reason = isBaseResponse(payload) ? (payload.error?.reason ?? null) : null;
    this.payload = payload;
  }
}

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function resolveUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${env.apiBaseUrl}${path}`;
}

// cookie 憑證與 CSRF token 只能送往 API 自家 origin(apiBaseUrl,未設定時為目前頁面 origin),
// 送往其他 host 會把使用者憑證洩漏給第三方。
export function isApiOrigin(url: string): boolean {
  const apiOrigin = env.apiBaseUrl
    ? new URL(env.apiBaseUrl, location.origin).origin
    : location.origin;
  return new URL(url, location.origin).origin === apiOrigin;
}

/** 後端取得 CSRF token 的端點(也會順便種下 csrftoken cookie) */
export const CSRF_PATH = "/auth/csrf";

let csrfToken: Promise<string> | null = null;

async function fetchCsrfToken(): Promise<string> {
  const url = resolveUrl(CSRF_PATH);
  const res = await fetch(url, { credentials: "include" });
  const payload = parseText(await res.text());
  const data = settle("GET", CSRF_PATH, url, res.status, payload);
  const token = (data as { csrf_token?: unknown } | null)?.csrf_token;
  if (typeof token !== "string" || !token) {
    throw new ApiError(res.status, `GET ${CSRF_PATH} returned no csrf_token`, payload);
  }
  return token;
}

/** 記憶體快取(同時多個請求共用一次抓取);失敗不快取,下次寫入再試 */
export function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  const pending = fetchCsrfToken();
  csrfToken = pending;
  pending.catch(() => {
    if (csrfToken === pending) csrfToken = null;
  });
  return pending;
}

/** 丟掉快取的 CSRF token(Django 登入時會輪替,舊的會被拒絕) */
export function resetCsrfToken(): void {
  csrfToken = null;
}

function isCsrfFailure(status: number, payload: unknown): boolean {
  return status === 403 && isBaseResponse(payload) && payload.error?.reason === "csrf_failed";
}

// 支援兩種錯誤格式:頂層 { message } 與團隊後端的 BaseResponse { data, error: { code, message } }
function errorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as { message?: unknown; error?: { message?: unknown } | null };
  const message = p.error?.message ?? p.message;
  return message === undefined ? undefined : String(message);
}

export function parseText(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * fetch 與 XHR(apiUpload)共用的回應處理:非 2xx 丟 ApiError(自家 401 清 session),
 * 成功時只解包自家 API 的 envelope;第三方回應即使長得像 {data, error} 也原樣回傳。
 */
export function settle(
  method: Method,
  path: string,
  url: string,
  status: number,
  payload: unknown,
): unknown {
  const trusted = isApiOrigin(url);
  if (status < 200 || status >= 300) {
    if (status === 401 && trusted) useAuthStore.getState().clear();
    // 不重試的呼叫端(apiUpload)至少讓下一次請求拿新 token
    if (trusted && isCsrfFailure(status, payload)) resetCsrfToken();
    const message = errorMessage(payload) ?? `${method} ${path} failed with ${status}`;
    throw new ApiError(status, message, payload);
  }
  return trusted && isBaseResponse(payload) ? payload.data : payload;
}

/** 不轉 JSON、原樣交給瀏覽器的 body;FormData 的 multipart boundary 由瀏覽器自己帶 */
function isRawBody(body: unknown): body is FormData | Blob | URLSearchParams | ArrayBuffer {
  return (
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer
  );
}

/**
 * 帶 cookie 憑證送請求並回傳原始 `Response`(不呼叫 `settle`、不清 session,由呼叫端決定怎麼處理失敗)。
 * 只有自家 API 帶 `credentials: "include"`;寫入另外帶 `X-CSRFToken`,403 `csrf_failed` 時
 * 重抓 token 並**只重送一次**——這是全專案唯一的 csrf_failed 判定與重試次數(`send()`、django-adapter 共用)。
 * 重試後仍失敗就把那個失敗的 Response 原樣回傳。
 */
export async function fetchWithCsrf(
  method: Method,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  // 只有自家 API 才帶 cookie;寫入另外要 X-CSRFToken(其他 host 兩者都不給)
  const trusted = isApiOrigin(url);
  const needsCsrf = trusted && method !== "GET";

  for (let attempt = 0; ; attempt++) {
    const headers = new Headers(init.headers);
    if (needsCsrf) headers.set("X-CSRFToken", await getCsrfToken());
    const res = await fetch(url, {
      ...init,
      ...(trusted && { credentials: "include" as const }),
      method,
      headers,
    });
    if (res.ok || !needsCsrf || attempt > 0) return res;
    // token 過期或被輪替(如剛登入):重抓後只重送一次;clone 讓呼叫端仍能讀 body
    if (!isCsrfFailure(res.status, parseText(await res.clone().text()))) return res;
    resetCsrfToken();
  }
}

async function send(
  method: Method,
  path: string,
  body: unknown,
  init: RequestInit | undefined,
): Promise<{ res: Response; url: string }> {
  const headers = new Headers(init?.headers);
  const payloadBody =
    body === undefined ? init?.body : isRawBody(body) ? body : JSON.stringify(body);
  // 只在 JSON body 時標 Content-Type:bodyless GET/DELETE 帶它會多觸發 CORS preflight,
  // FormData 自己設則會少了 multipart boundary,後端解析失敗
  if (typeof payloadBody === "string" && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  const url = resolveUrl(path);

  const res = await fetchWithCsrf(method, url, { ...init, headers, body: payloadBody });
  if (!res.ok) settle(method, path, url, res.status, parseText(await res.text()));
  return { res, url };
}

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const { res, url } = await send(method, path, body, init);
  return settle(method, path, url, res.status, parseText(await res.text())) as T;
}

/**
 * 下載後端匯出的檔案(非 JSON 回應)。帶 cookie 與 CSRF、錯誤轉 ApiError 的規則與 apiGet / apiPost 相同;
 * 檔名取自 `Content-Disposition`(支援 `filename*=UTF-8''…`),沒有則為 null。
 * ```ts
 * const { blob, filename } = await apiDownload("/reports/export?year=2026");
 * downloadBlob(blob, filename ?? "report.xlsx");
 * ```
 * 匯出條件太多塞不進 query string 時用 POST:`apiDownload(path, { method: "POST", body })`。
 */
export async function apiDownload(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; init?: RequestInit } = {},
): Promise<{ blob: Blob; filename: string | null }> {
  const { res } = await send(options.method ?? "GET", path, options.body, options.init);
  const filename = parseContentDispositionFilename(res.headers.get("Content-Disposition"));
  return { blob: await res.blob(), filename };
}

export function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>("GET", path, undefined, init);
}
/** body 可以是一般物件(轉 JSON)或 FormData / Blob / URLSearchParams(原樣送出)。需要上傳進度改用 apiUpload */
export function apiPost<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return request<T>("POST", path, body, init);
}
export function apiPut<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return request<T>("PUT", path, body, init);
}
export function apiPatch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return request<T>("PATCH", path, body, init);
}
export function apiDelete<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>("DELETE", path, undefined, init);
}
