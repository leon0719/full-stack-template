import type { AuthAdapter, User } from "../model/types";

// 僅供 demo:記住「登入的帳號名稱」讓重新整理後 me() 能還原,不是憑證(真實後端的憑證是 HttpOnly cookie)
const KEY = "auth.fake-user";

const ACCOUNTS: Record<string, User> = {
  admin: {
    id: "1",
    name: "admin",
    roles: ["admin", "user"],
    displayName: "Admin Demo",
    pictureUrl: undefined,
  },
  user: {
    id: "2",
    name: "user",
    roles: ["user"],
    displayName: "User Demo",
    pictureUrl: undefined,
  },
};

// LINE 沒有真的 OAuth 網域可跳,demo 用的假 code 直接對應假帳號。
const FAKE_CODE_TO_ACCOUNT: Record<string, string> = {
  "fake-code-admin": "admin",
  "fake-code-user": "user",
};

export const fakeAuthAdapter: AuthAdapter = {
  getLineLoginUrl() {
    return "/login/callback?code=fake-code-user";
  },
  async completeLineLogin(code) {
    const name = FAKE_CODE_TO_ACCOUNT[code];
    const user = name ? ACCOUNTS[name] : undefined;
    if (!name || !user) throw new Error("Invalid or expired code");
    localStorage.setItem(KEY, name);
    return user;
  },
  async logout() {
    localStorage.removeItem(KEY);
  },
  async me() {
    const name = localStorage.getItem(KEY);
    return (name && ACCOUNTS[name]) || null;
  },
};
