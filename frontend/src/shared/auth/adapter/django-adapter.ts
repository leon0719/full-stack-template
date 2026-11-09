import type { components } from "@/shared/api";
import { env } from "@/shared/config";
import { tokenStorage } from "../lib/token-storage";
import type { AuthAdapter, User } from "../model/types";

// 型別由後端 OpenAPI 產生(`make gen-api`),不要手寫
type MeResponse = components["schemas"]["MeResponse"];

// 後端 accounts 尚無角色概念，固定給 "user"；接 RBAC 時在此對映後端的角色欄位。
function toUser(me: MeResponse): User {
  return {
    id: String(me.id),
    name: me.username,
    roles: ["user"],
    displayName: me.display_name ?? undefined,
    pictureUrl: me.picture_url ?? undefined,
  };
}

// 後端回 BaseResponse:成功 { data, error: null }、失敗 { data: null, error: { code, message, reason } }。
// 不走 shared/api 的 client(它 import shared/auth,會循環依賴),這裡自己解 envelope。
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

async function fetchMe(token: string): Promise<User | null> {
  const res = await fetch(`${env.apiBaseUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) return null;
  if (!res.ok)
    throw new Error(await extractErrorMessage(res, `GET /auth/me failed with ${res.status}`));
  return toUser(await readData<MeResponse>(res));
}

// 串接 backend apps/accounts 的 opaque bearer token 認證。登入只能透過 LINE:
// getLineLoginUrl() 產生整頁導轉連結;LINE 完成授權後,後端把瀏覽器導回
// /login/callback?code=...,該頁呼叫 completeLineLogin() 把 code 換成 token,
// 再沿用既有兩段式流程(存 token → 打 /auth/me 取得使用者資料)。
export const djangoAuthAdapter: AuthAdapter = {
  getLineLoginUrl() {
    return `${env.apiBaseUrl}/accounts/line/login/?process=login`;
  },

  async completeLineLogin(code) {
    const res = await fetch(`${env.apiBaseUrl}/auth/line/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      throw new Error(
        await extractErrorMessage(res, `POST /auth/line/exchange failed with ${res.status}`),
      );
    }
    const { token } = await readData<{ token: string }>(res);
    const user = await fetchMe(token);
    if (!user) throw new Error("Login succeeded but the issued token was rejected");
    tokenStorage.set(token);
    return { user, token };
  },

  async logout() {
    const token = tokenStorage.get();
    try {
      if (token) {
        await fetch(`${env.apiBaseUrl}/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } finally {
      // 就算 server 端撤銷失敗也要清本地 session,避免卡在登不出的狀態
      tokenStorage.clear();
    }
  },

  async me() {
    const token = tokenStorage.get();
    if (!token) return null;
    const user = await fetchMe(token);
    if (!user) {
      tokenStorage.clear();
      return null;
    }
    return { user, token };
  },
};
