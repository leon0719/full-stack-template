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
const csrf = (token = "csrf-1") => ok({ csrf_token: token });

const ME = {
  id: 1,
  username: "u",
  email: "",
  display_name: "Alice",
  picture_url: "https://x/a.jpg",
  roles: ["user"],
};

const initOf = (spy: { mock: { calls: unknown[][] } }, call: number) =>
  spy.mock.calls[call][1] as RequestInit;
const urlOf = (spy: { mock: { calls: unknown[][] } }, call: number) => spy.mock.calls[call][0];

describe("djangoAuthAdapter", () => {
  beforeEach(async () => {
    vi.stubGlobal("localStorage", makeStorage());
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");
    // env 在模組載入時快照,所以 client 也得在 stubEnv 之後才 import
    const { resetCsrfToken } = await import("@/shared/api/client");
    resetCsrfToken();
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

  it("completeLineLogin posts code with credentials + CSRF header, then reads /auth/me", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf("csrf-1"))
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok(ME));

    const { djangoAuthAdapter } = await import("./django-adapter");
    const user = await djangoAuthAdapter.completeLineLogin("code-abc");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(urlOf(fetchMock, 0)).toBe("https://api.example.com/auth/csrf");
    expect(urlOf(fetchMock, 1)).toBe("https://api.example.com/auth/line/exchange");
    const exchange = initOf(fetchMock, 1);
    expect(exchange.method).toBe("POST");
    expect(exchange.credentials).toBe("include");
    expect(exchange.body).toBe(JSON.stringify({ code: "code-abc" }));
    const headers = new Headers(exchange.headers);
    expect(headers.get("X-CSRFToken")).toBe("csrf-1");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBeNull();

    expect(urlOf(fetchMock, 2)).toBe("https://api.example.com/auth/me");
    expect(initOf(fetchMock, 2).credentials).toBe("include");

    expect(user).toEqual({
      id: "1",
      name: "u",
      roles: ["user"],
      displayName: "Alice",
      pictureUrl: "https://x/a.jpg",
    });
    // 憑證是 HttpOnly cookie,前端不存任何東西
    expect(localStorage.length).toBe(0);
  });

  it("completeLineLogin refetches CSRF once on csrf_failed, then succeeds", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf("stale"))
      .mockResolvedValueOnce(fail(403, "CSRF check failed", "csrf_failed"))
      .mockResolvedValueOnce(csrf("fresh"))
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok(ME));

    const { djangoAuthAdapter } = await import("./django-adapter");
    await djangoAuthAdapter.completeLineLogin("code-abc");

    expect(new Headers(initOf(fetchMock, 1).headers).get("X-CSRFToken")).toBe("stale");
    expect(new Headers(initOf(fetchMock, 3).headers).get("X-CSRFToken")).toBe("fresh");
  });

  it("throws when the exchange call fails (no retry for other errors)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(fail(401, "Invalid or expired code", "invalid_exchange_code"));

    const { djangoAuthAdapter } = await import("./django-adapter");
    await expect(djangoAuthAdapter.completeLineLogin("bad-code")).rejects.toThrow(
      /invalid or expired code/i,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the session cookie is not accepted right after the exchange", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(fail(401, "Authentication required", "unauthenticated"));

    const { djangoAuthAdapter } = await import("./django-adapter");
    await expect(djangoAuthAdapter.completeLineLogin("code-abc")).rejects.toThrow(/cookie/i);
  });

  it("me() restores the session from the cookie without a CSRF round trip", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      ok({
        id: 7,
        username: "alice",
        email: "alice@example.com",
        display_name: "Alice Smith",
        picture_url: "https://example.com/alice.jpg",
        roles: ["admin", "user"],
      }),
    );

    const { djangoAuthAdapter } = await import("./django-adapter");
    const user = await djangoAuthAdapter.me();

    expect(user).toEqual({
      id: "7",
      name: "alice",
      roles: ["admin", "user"],
      displayName: "Alice Smith",
      pictureUrl: "https://example.com/alice.jpg",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock, 0)).toBe("https://api.example.com/auth/me");
    expect(initOf(fetchMock, 0).credentials).toBe("include");
    expect(new Headers(initOf(fetchMock, 0).headers).get("Authorization")).toBeNull();
  });

  it("maps roles from /auth/me instead of hard-coding them, and stringifies the numeric id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      ok({
        id: 42,
        username: "root",
        email: "",
        display_name: null,
        picture_url: null,
        roles: ["admin", "user"],
      }),
    );

    const { djangoAuthAdapter } = await import("./django-adapter");
    const user = await djangoAuthAdapter.me();

    expect(user?.id).toBe("42");
    expect(typeof user?.id).toBe("string");
    expect(user?.roles).toEqual(["admin", "user"]);
  });

  it("me() returns null on 401 without touching localStorage", async () => {
    const storage = makeStorage();
    vi.stubGlobal("localStorage", storage);
    const getItem = vi.spyOn(storage, "getItem");
    const setItem = vi.spyOn(storage, "setItem");
    const removeItem = vi.spyOn(storage, "removeItem");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      fail(401, "Authentication required", "unauthenticated"),
    );

    const { djangoAuthAdapter } = await import("./django-adapter");
    await expect(djangoAuthAdapter.me()).resolves.toBeNull();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("me() throws on a non-401 failure (init() treats it as logged out)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      fail(500, "Internal error", "internal_error"),
    );

    const { djangoAuthAdapter } = await import("./django-adapter");
    await expect(djangoAuthAdapter.me()).rejects.toThrow(/internal error/i);
  });

  it("logout posts with CSRF header and credentials", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf("csrf-9"))
      .mockResolvedValueOnce(ok(null));

    const { djangoAuthAdapter } = await import("./django-adapter");
    await djangoAuthAdapter.logout();

    expect(urlOf(fetchMock, 1)).toBe("https://api.example.com/auth/logout");
    const init = initOf(fetchMock, 1);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    const headers = new Headers(init.headers);
    expect(headers.get("X-CSRFToken")).toBe("csrf-9");
    expect(headers.get("Authorization")).toBeNull();
  });

  it("logout refetches CSRF once on csrf_failed so the cookie really gets cleared", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf("stale"))
      .mockResolvedValueOnce(fail(403, "CSRF check failed", "csrf_failed"))
      .mockResolvedValueOnce(csrf("fresh"))
      .mockResolvedValueOnce(ok(null));

    const { djangoAuthAdapter } = await import("./django-adapter");
    await djangoAuthAdapter.logout();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new Headers(initOf(fetchMock, 3).headers).get("X-CSRFToken")).toBe("fresh");
  });

  it("logout rejects on an HTTP failure so the cookie is not silently left alive", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(fail(500, "Internal error", "internal_error"));

    const { djangoAuthAdapter } = await import("./django-adapter");
    await expect(djangoAuthAdapter.logout()).rejects.toThrow(/internal error/i);
  });

  it("logout rejects after exactly one csrf_failed retry", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf("a"))
      .mockResolvedValueOnce(fail(403, "CSRF check failed", "csrf_failed"))
      .mockResolvedValueOnce(csrf("b"))
      .mockResolvedValueOnce(fail(403, "CSRF check failed", "csrf_failed"));

    const { djangoAuthAdapter } = await import("./django-adapter");
    await expect(djangoAuthAdapter.logout()).rejects.toThrow(/csrf check failed/i);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("logout resolves on 401: the session is already gone server-side", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(fail(401, "Authentication required", "unauthenticated"));

    const { djangoAuthAdapter } = await import("./django-adapter");
    await expect(djangoAuthAdapter.logout()).resolves.toBeUndefined();
  });

  it("logout rejects when the request cannot reach the server", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf())
      .mockRejectedValueOnce(new Error("network down"));

    const { djangoAuthAdapter } = await import("./django-adapter");
    await expect(djangoAuthAdapter.logout()).rejects.toThrow("network down");
  });
});
