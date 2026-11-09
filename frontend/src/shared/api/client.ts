import { useAuthStore } from "@/shared/auth";
import { env } from "@/shared/config";

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

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function resolveUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${env.apiBaseUrl}${path}`;
}

// Bearer token 只能送往 API 自家 origin(apiBaseUrl,未設定時為目前頁面 origin),
// 送往其他 host 會把使用者憑證洩漏給第三方。
function isApiOrigin(url: string): boolean {
  const apiOrigin = env.apiBaseUrl
    ? new URL(env.apiBaseUrl, location.origin).origin
    : location.origin;
  return new URL(url, location.origin).origin === apiOrigin;
}

// 支援兩種錯誤格式:頂層 { message } 與團隊後端的 BaseResponse { data, error: { code, message } }
function errorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as { message?: unknown; error?: { message?: unknown } | null };
  const message = p.error?.message ?? p.message;
  return message === undefined ? undefined : String(message);
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  // 只在真的有 body 時標 JSON;bodyless GET/DELETE 帶 Content-Type 會多觸發 CORS preflight
  if (body !== undefined || init?.body != null) headers.set("Content-Type", "application/json");
  const url = resolveUrl(path);
  const trusted = isApiOrigin(url);
  const token = useAuthStore.getState().token;
  if (token && trusted) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(url, {
    ...init,
    method,
    headers,
    body: body === undefined ? init?.body : JSON.stringify(body),
  });

  const payload = await parseBody(res);
  if (!res.ok) {
    if (res.status === 401 && trusted) useAuthStore.getState().clear();
    const message = errorMessage(payload) ?? `${method} ${path} failed with ${res.status}`;
    throw new ApiError(res.status, message, payload);
  }
  // 只解包自家 API 的 envelope;第三方回應即使長得像 {data, error} 也原樣回傳
  return (trusted && isBaseResponse(payload) ? payload.data : payload) as T;
}

export function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>("GET", path, undefined, init);
}
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
