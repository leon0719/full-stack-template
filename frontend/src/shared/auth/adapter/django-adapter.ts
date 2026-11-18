import { type components, getCsrfToken, resetCsrfToken } from "@/shared/api";
import { env } from "@/shared/config";
import type { AuthAdapter, User } from "../model/types";

// 型別由後端 OpenAPI 產生(`make gen-api`),不要手寫
type MeResponse = components["schemas"]["MeResponse"];

// 角色直接用後端 /auth/me 的 roles(backend/apps/accounts/roles.py:Django Group + 隱含 user、
// superuser 隱含 admin)。後端 Role 與前端 shared/auth 的 Role 必須同步——新增角色兩邊一起改,
// make gen-api 後 tsc 會在這裡報型別不相容。id 後端是數字,前端 User.id 統一用字串。
function toUser(me: MeResponse): User {
  return {
    id: String(me.id),
    name: me.username,
    roles: me.roles,
    displayName: me.display_name ?? undefined,
    pictureUrl: me.picture_url ?? undefined,
  };
}

// 後端回 BaseResponse:成功 { data, error: null }、失敗 { data: null, error: { code, message, reason } }。
// 這裡用原生 fetch 自己解 envelope:shared/api 的 client 失敗時會 clear() auth store,
// 登入流程要自己決定怎麼處理 401。(CSRF token 仍共用 client 的快取;函式只在呼叫時才用到,
// 所以 client ↔ auth 的 import 循環在載入階段是安全的。)
async function readData<T>(res: Response): Promise<T> {
  return ((await res.json()) as { data: T }).data;
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const payload = (await res.json()) as { error?: { message?: unknown } | null };
    if (payload?.error?.message !== undefined) return String(payload.error.message);
  } catch {
    // 非 JSON body,用 fallback
  }
  return fallback;
}

async function isCsrfFailure(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  try {
    const payload = (await res.clone().json()) as { error?: { reason?: unknown } | null };
    return payload?.error?.reason === "csrf_failed";
  } catch {
    return false;
  }
}

// cookie 認證的寫入要帶 X-CSRFToken;token 過期或被輪替(csrf_failed)時重抓後只重送一次,
// 否則 logout 會悄悄失敗、cookie 還在。
async function post(path: string, body?: unknown): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${env.apiBaseUrl}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRFToken": await getCsrfToken() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (attempt === 0 && (await isCsrfFailure(res))) {
      resetCsrfToken();
      continue;
    }
    return res;
  }
}

async function fetchMe(): Promise<User | null> {
  const res = await fetch(`${env.apiBaseUrl}/auth/me`, { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok)
    throw new Error(await extractErrorMessage(res, `GET /auth/me failed with ${res.status}`));
  return toUser(await readData<MeResponse>(res));
}

// 串接 backend apps/accounts 的 HttpOnly cookie 認證。登入只能透過 LINE:
// getLineLoginUrl() 產生整頁導轉連結;LINE 完成授權後,後端把瀏覽器導回
// /login/callback?code=...,該頁呼叫 completeLineLogin() 把 code 換成 cookie
// (POST /auth/line/exchange,後端以 Set-Cookie 發憑證,body 不含 token),
// 再打 /auth/me 取得使用者資料。前端不碰也不存任何 token。
export const djangoAuthAdapter: AuthAdapter = {
  getLineLoginUrl() {
    return `${env.apiBaseUrl}/accounts/line/login/?process=login`;
  },

  async completeLineLogin(code) {
    const res = await post("/auth/line/exchange", { code });
    if (!res.ok) {
      throw new Error(
        await extractErrorMessage(res, `POST /auth/line/exchange failed with ${res.status}`),
      );
    }
    const user = await fetchMe();
    if (!user) throw new Error("Login succeeded but the session cookie was not accepted");
    return user;
  },

  async logout() {
    // 後端清 cookie 並撤銷 token;網路失敗讓 rejection 往上冒(cookie 沒清,假裝登出會騙到使用者)
    await post("/auth/logout");
  },

  me: fetchMe,
};
