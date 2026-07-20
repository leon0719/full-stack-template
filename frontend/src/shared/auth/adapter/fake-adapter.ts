import { tokenStorage } from "../lib/token-storage";
import type { AuthAdapter, AuthSession, User } from "../model/types";

const ACCOUNTS: Record<string, { password: string; user: User; token: string }> = {
  admin: {
    password: "admin",
    token: "fake-token-admin",
    user: { id: "1", name: "admin", roles: ["admin", "user"] },
  },
  user: {
    password: "user",
    token: "fake-token-user",
    user: { id: "2", name: "user", roles: ["user"] },
  },
};

function findByToken(token: string): AuthSession | null {
  const entry = Object.values(ACCOUNTS).find((a) => a.token === token);
  return entry ? { user: entry.user, token: entry.token } : null;
}

export const fakeAuthAdapter: AuthAdapter = {
  async login(credentials) {
    const entry = ACCOUNTS[credentials.username];
    if (!entry || entry.password !== credentials.password) {
      throw new Error("Invalid credentials");
    }
    tokenStorage.set(entry.token);
    return { user: entry.user, token: entry.token };
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
