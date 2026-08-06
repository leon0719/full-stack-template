import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAuthAdapter } from "../adapter/fake-adapter";
import { setAuthAdapter, useAuthStore } from "./auth-store";

const makeStorage = (): Storage => {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
};

describe("useAuthStore", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
    setAuthAdapter(fakeAuthAdapter);
    useAuthStore.setState({ user: null, token: null, status: "idle" });
  });

  it("starts unauthenticated by default", () => {
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it("completes LINE login with a valid code", async () => {
    await useAuthStore.getState().completeLineLogin("fake-code-admin");
    const s = useAuthStore.getState();
    expect(s.status).toBe("authenticated");
    expect(s.user?.roles).toContain("admin");
    expect(s.token).not.toBeNull();
  });

  it("rejects an invalid code and stays unauthenticated", async () => {
    await expect(useAuthStore.getState().completeLineLogin("bad-code")).rejects.toThrow();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });

  it("logout clears user, token and storage", async () => {
    await useAuthStore.getState().completeLineLogin("fake-code-user");
    await useAuthStore.getState().logout();
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.token).toBeNull();
    expect(localStorage.getItem("auth.token")).toBeNull();
  });

  it("clear() resets state synchronously without calling adapter", async () => {
    await useAuthStore.getState().completeLineLogin("fake-code-user");
    useAuthStore.getState().clear();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
    expect(localStorage.getItem("auth.token")).toBeNull();
  });

  it("init() restores an existing session from a valid token", async () => {
    await useAuthStore.getState().completeLineLogin("fake-code-admin");
    useAuthStore.setState({ user: null, token: null, status: "idle" });
    await useAuthStore.getState().init();
    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().user?.name).toBe("admin");
  });

  it("init() ends unauthenticated when no token exists", async () => {
    await useAuthStore.getState().init();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });

  it("init() falls back to unauthenticated when adapter.me() rejects", async () => {
    setAuthAdapter({
      getLineLoginUrl: () => "/login/callback?code=unused",
      completeLineLogin: async () => {
        throw new Error("unused");
      },
      logout: async () => {},
      me: async () => {
        throw new Error("network down");
      },
    });
    await expect(useAuthStore.getState().init()).resolves.toBeUndefined();
    const s = useAuthStore.getState();
    expect(s.status).toBe("unauthenticated");
    expect(s.user).toBeNull();
    expect(s.token).toBeNull();
  });

  describe("production guard", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("completeLineLogin() fails fast when the fake adapter is still active in production", async () => {
      vi.stubEnv("PROD", true);
      await expect(
        useAuthStore.getState().completeLineLogin("fake-code-admin"),
      ).rejects.toThrow(/production/);
    });

    it("init() fails fast when the fake adapter is still active in production", async () => {
      vi.stubEnv("PROD", true);
      await expect(useAuthStore.getState().init()).rejects.toThrow(/production/);
    });

    it("allows a real adapter in production", async () => {
      vi.stubEnv("PROD", true);
      setAuthAdapter({
        getLineLoginUrl: () => "https://real.example.com/accounts/line/login/?process=login",
        completeLineLogin: async () => ({
          user: { id: "9", name: "real", roles: ["user"] },
          token: "real-token",
        }),
        logout: async () => {},
        me: async () => null,
      });
      await useAuthStore.getState().completeLineLogin("code-x");
      expect(useAuthStore.getState().status).toBe("authenticated");
    });
  });
});
