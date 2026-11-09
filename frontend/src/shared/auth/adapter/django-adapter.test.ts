import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// 後端一律回 BaseResponse envelope:成功 { data, error: null }、失敗 { data: null, error }
const ok = (data: unknown) => new Response(JSON.stringify({ data, error: null }), { status: 200 });
const fail = (status: number, message: string, reason: string) =>
  new Response(JSON.stringify({ data: null, error: { code: status, message, reason } }), {
    status,
  });

describe("djangoAuthAdapter", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("builds the LINE authorize URL against the API origin", async () => {
    const { djangoAuthAdapter } = await import("./django-adapter");
    expect(djangoAuthAdapter.getLineLoginUrl()).toBe(
      "https://api.example.com/accounts/line/login/?process=login",
    );
  });

  it("exchanges a code for a token then fetches /auth/me", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok({ token: "tok-123" }))
      .mockResolvedValueOnce(
        ok({
          id: 1,
          username: "u",
          email: "",
          display_name: "Alice",
          picture_url: "https://x/a.jpg",
        }),
      );

    const { djangoAuthAdapter } = await import("./django-adapter");
    const session = await djangoAuthAdapter.completeLineLogin("code-abc");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.example.com/auth/line/exchange",
      expect.objectContaining({ method: "POST" }),
    );
    expect(session.token).toBe("tok-123");
    expect(session.user).toEqual({
      id: "1",
      name: "u",
      roles: ["user"],
      displayName: "Alice",
      pictureUrl: "https://x/a.jpg",
    });
    expect(localStorage.getItem("auth.token")).toBe("tok-123");
  });

  it("throws when the exchange call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      fail(401, "Invalid or expired code", "invalid_exchange_code"),
    );

    const { djangoAuthAdapter } = await import("./django-adapter");
    await expect(djangoAuthAdapter.completeLineLogin("bad-code")).rejects.toThrow(
      /invalid or expired code/i,
    );
  });

  it("me() returns null without calling the API when no token is persisted", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const { djangoAuthAdapter } = await import("./django-adapter");
    await expect(djangoAuthAdapter.me()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("me() restores the session from a persisted token", async () => {
    localStorage.setItem("auth.token", "tok-restored");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      ok({
        id: 7,
        username: "alice",
        email: "alice@example.com",
        display_name: "Alice Smith",
        picture_url: "https://example.com/alice.jpg",
      }),
    );

    const { djangoAuthAdapter } = await import("./django-adapter");
    const session = await djangoAuthAdapter.me();

    expect(session).toEqual({
      user: {
        id: "7",
        name: "alice",
        roles: ["user"],
        displayName: "Alice Smith",
        pictureUrl: "https://example.com/alice.jpg",
      },
      token: "tok-restored",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/auth/me", expect.any(Object));
  });

  it("me() clears the stored token and returns null when /auth/me responds 401", async () => {
    localStorage.setItem("auth.token", "tok-expired");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      fail(401, "Authentication required", "unauthenticated"),
    );

    const { djangoAuthAdapter } = await import("./django-adapter");
    await expect(djangoAuthAdapter.me()).resolves.toBeNull();
    expect(localStorage.getItem("auth.token")).toBeNull();
  });

  it("logout() revokes the token server-side and clears local storage", async () => {
    localStorage.setItem("auth.token", "tok-1");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok(null));

    const { djangoAuthAdapter } = await import("./django-adapter");
    await djangoAuthAdapter.logout();

    expect(localStorage.getItem("auth.token")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("logout() clears local storage even when the revoke request fails", async () => {
    localStorage.setItem("auth.token", "tok-1");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));

    const { djangoAuthAdapter } = await import("./django-adapter");
    await expect(djangoAuthAdapter.logout()).rejects.toThrow("network down");
    expect(localStorage.getItem("auth.token")).toBeNull();
  });
});
