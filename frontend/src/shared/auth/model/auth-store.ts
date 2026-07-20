import { create } from "zustand";
import { fakeAuthAdapter } from "../adapter/fake-adapter";
import { tokenStorage } from "../lib/token-storage";
import type { AuthAdapter, AuthStatus, Credentials, User } from "./types";

let adapter: AuthAdapter = fakeAuthAdapter;

export function setAuthAdapter(next: AuthAdapter): void {
  adapter = next;
}

// 直接讀 import.meta.env(而非 shared/config 的載入期快照),測試才能以 vi.stubEnv 覆蓋。
function assertAdapterSafeForProd(): void {
  if (import.meta.env.PROD && adapter === fakeAuthAdapter) {
    throw new Error(
      "fakeAuthAdapter must not be used in production; call setAuthAdapter(realAdapter) at startup",
    );
  }
}

interface AuthState {
  user: User | null;
  token: string | null;
  status: AuthStatus;
  login: (credentials: Credentials) => Promise<void>;
  logout: () => Promise<void>;
  clear: () => void;
  init: () => Promise<void>;
}

// session-ready promise:route guard 與 app 啟動共用同一次 init(),
// 確保硬重新整理/深連結時 beforeLoad 會等 session 恢復完才判斷。
let sessionReady: Promise<void> | null = null;

export function initAuth(): Promise<void> {
  sessionReady ??= useAuthStore.getState().init();
  return sessionReady;
}

export function resetAuthForTests(): void {
  sessionReady = null;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  status: "idle",
  login: async (credentials) => {
    assertAdapterSafeForProd();
    set({ status: "loading" });
    try {
      const { user, token } = await adapter.login(credentials);
      set({ user, token, status: "authenticated" });
    } catch (error) {
      set({ user: null, token: null, status: "unauthenticated" });
      throw error;
    }
  },
  logout: async () => {
    await adapter.logout();
    set({ user: null, token: null, status: "unauthenticated" });
  },
  clear: () => {
    tokenStorage.clear();
    set({ user: null, token: null, status: "unauthenticated" });
  },
  init: async () => {
    assertAdapterSafeForProd();
    set({ status: "loading" });
    // me() 失敗(網路瞬斷、後端 5xx)視同未登入,不可讓 rejection 往上冒:
    // initAuth 會快取這個 promise,一旦 reject 所有 route 的 beforeLoad 都會永久炸掉。
    let session: Awaited<ReturnType<AuthAdapter["me"]>> = null;
    try {
      session = await adapter.me();
    } catch {
      session = null;
    }
    if (session) {
      set({ user: session.user, token: session.token, status: "authenticated" });
    } else {
      set({ user: null, token: null, status: "unauthenticated" });
    }
  },
}));
