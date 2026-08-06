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
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "tok-123" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 1, username: "u", email: "", display_name: "Alice", picture_url: "https://x/a.jpg" }),
          { status: 200 },
        ),
      );

    const { djangoAuthAdapter } = await import("./django-adapter");
    const session = await djangoAuthAdapter.completeLineLogin("code-abc");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.example.com/auth/line/exchange",
      expect.objectContaining({ method: "POST" }),
    );
    expect(session.token).toBe("tok-123");
    expect(session.user).toEqual({ id: "1", name: "u", roles: ["user"], displayName: "Alice", pictureUrl: "https://x/a.jpg" });
    expect(localStorage.getItem("auth.token")).toBe("tok-123");
  });

  it("throws when the exchange call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Invalid or expired code" }), { status: 401 }),
    );

    const { djangoAuthAdapter } = await import("./django-adapter");
    await expect(djangoAuthAdapter.completeLineLogin("bad-code")).rejects.toThrow(/invalid or expired code/i);
  });
});
