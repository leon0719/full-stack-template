import { env } from "@/shared/config";
import { tokenStorage } from "../lib/token-storage";
import type { AuthAdapter, User } from "../model/types";

interface MeResponse {
  id: number;
  username: string;
  email: string;
}

// 後端 accounts 尚無角色概念，固定給 "user"；接 RBAC 時在此對映後端的角色欄位。
function toUser(me: MeResponse): User {
  return { id: String(me.id), name: me.username, roles: ["user"] };
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const payload: unknown = await res.json();
    if (payload && typeof payload === "object" && "detail" in payload) {
      return String((payload as { detail: unknown }).detail);
    }
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
  if (!res.ok) throw new Error(await extractErrorMessage(res, `GET /auth/me failed with ${res.status}`));
  return toUser((await res.json()) as MeResponse);
}

// 串接 backend apps/accounts 的 opaque bearer token 認證:
// login 只回 {token},user 資料需再打 /auth/me,故 login 為兩段式。
export const djangoAuthAdapter: AuthAdapter = {
  async login(credentials) {
    const res = await fetch(`${env.apiBaseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    if (!res.ok) {
      throw new Error(await extractErrorMessage(res, `POST /auth/login failed with ${res.status}`));
    }
    const { token } = (await res.json()) as { token: string };
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
