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

  it("logs in with valid credentials", async () => {
    await useAuthStore.getState().login({ username: "admin", password: "admin" });
    const s = useAuthStore.getState();
    expect(s.status).toBe("authenticated");
    expect(s.user?.roles).toContain("admin");
    expect(s.token).not.toBeNull();
  });

  it("rejects invalid credentials and stays unauthenticated", async () => {
    await expect(
      useAuthStore.getState().login({ username: "admin", password: "wrong" }),
    ).rejects.toThrow();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });

  it("logout clears user, token and storage", async () => {
    await useAuthStore.getState().login({ username: "user", password: "user" });
    await useAuthStore.getState().logout();
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.token).toBeNull();
    expect(localStorage.getItem("auth.token")).toBeNull();
  });

  it("clear() resets state synchronously without calling adapter", async () => {
    await useAuthStore.getState().login({ username: "user", password: "user" });
    useAuthStore.getState().clear();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
    expect(localStorage.getItem("auth.token")).toBeNull();
  });

  it("init() restores an existing session from a valid token", async () => {
    await useAuthStore.getState().login({ username: "admin", password: "admin" });
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
      login: async () => {
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

    it("login() fails fast when the fake adapter is still active in production", async () => {
      vi.stubEnv("PROD", true);
      await expect(
        useAuthStore.getState().login({ username: "admin", password: "admin" }),
      ).rejects.toThrow(/production/);
    });

    it("init() fails fast when the fake adapter is still active in production", async () => {
      vi.stubEnv("PROD", true);
      await expect(useAuthStore.getState().init()).rejects.toThrow(/production/);
    });

    it("allows a real adapter in production", async () => {
      vi.stubEnv("PROD", true);
      setAuthAdapter({
        login: async () => ({
          user: { id: "9", name: "real", roles: ["user"] },
          token: "real-token",
        }),
        logout: async () => {},
        me: async () => null,
      });
      await useAuthStore.getState().login({ username: "x", password: "y" });
      expect(useAuthStore.getState().status).toBe("authenticated");
    });
  });
});
