import { tokenStorage } from "../lib/token-storage";
import type { AuthAdapter, AuthSession, User } from "../model/types";

const ACCOUNTS: Record<string, { user: User; token: string }> = {
  "fake-token-admin": {
    token: "fake-token-admin",
    user: { id: "1", name: "admin", roles: ["admin", "user"], displayName: "Admin Demo", pictureUrl: undefined },
  },
  "fake-token-user": {
    token: "fake-token-user",
    user: { id: "2", name: "user", roles: ["user"], displayName: "User Demo", pictureUrl: undefined },
  },
};

// LINE 沒有真的 OAuth 網域可跳,demo 用的假 code 直接對應假 token。
const FAKE_CODE_TO_TOKEN: Record<string, string> = {
  "fake-code-admin": "fake-token-admin",
  "fake-code-user": "fake-token-user",
};

function findByToken(token: string): AuthSession | null {
  const entry = ACCOUNTS[token];
  return entry ? { user: entry.user, token: entry.token } : null;
}

export const fakeAuthAdapter: AuthAdapter = {
  getLineLoginUrl() {
    return "/login/callback?code=fake-code-user";
  },
  async completeLineLogin(code) {
    const token = FAKE_CODE_TO_TOKEN[code];
    const session = token ? findByToken(token) : null;
    if (!session) throw new Error("Invalid or expired code");
    tokenStorage.set(session.token);
    return session;
  },
  async logout() {
    tokenStorage.clear();
  },
  async me() {
    const token = tokenStorage.get();
    if (!token) return null;
    return findByToken(token);
  },
};
