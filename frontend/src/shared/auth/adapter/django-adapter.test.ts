import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenStorage } from "../lib/token-storage";
import { djangoAuthAdapter } from "./django-adapter";

const ME_PAYLOAD = { id: 7, username: "alice", email: "alice@example.com" };
const ALICE = { id: "7", name: "alice", roles: ["user"] };

type MockResponse = { status: number; json?: unknown };

function stubFetch(...responses: MockResponse[]) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce(
      new Response(r.json === undefined ? null : JSON.stringify(r.json), {
        status: r.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  // Mock localStorage for tests
  const store: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((key) => {
        delete store[key];
      });
    }),
  };
  vi.stubGlobal("localStorage", mockLocalStorage);
  tokenStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("djangoAuthAdapter.login", () => {
  it("exchanges credentials for a token then loads the user profile", async () => {
    const fetchMock = stubFetch({ status: 200, json: { token: "t-1" } }, { status: 200, json: ME_PAYLOAD });

    const session = await djangoAuthAdapter.login({ username: "alice", password: "pw12345678" });

    expect(session).toEqual({ user: ALICE, token: "t-1" });
    expect(tokenStorage.get()).toBe("t-1");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/auth/me", expect.anything());
  });

  it("throws on invalid credentials and does not persist a token", async () => {
    stubFetch({ status: 401, json: { detail: "Invalid credentials" } });

    await expect(
      djangoAuthAdapter.login({ username: "alice", password: "wrong" }),
    ).rejects.toThrow("Invalid credentials");
    expect(tokenStorage.get()).toBeNull();
  });
});

describe("djangoAuthAdapter.me", () => {
  it("returns null without calling the API when no token is persisted", async () => {
    const fetchMock = stubFetch();

    await expect(djangoAuthAdapter.me()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restores the session from a persisted token", async () => {
    tokenStorage.set("t-1");
    stubFetch({ status: 200, json: ME_PAYLOAD });

    await expect(djangoAuthAdapter.me()).resolves.toEqual({ user: ALICE, token: "t-1" });
  });

  it("clears a rejected token and returns null on 401", async () => {
    tokenStorage.set("t-expired");
    stubFetch({ status: 401, json: { detail: "Invalid token" } });

    await expect(djangoAuthAdapter.me()).resolves.toBeNull();
    expect(tokenStorage.get()).toBeNull();
  });
});

describe("djangoAuthAdapter.logout", () => {
  it("revokes the token server-side and clears local storage", async () => {
    tokenStorage.set("t-1");
    const fetchMock = stubFetch({ status: 200, json: { detail: "Logged out" } });

    await djangoAuthAdapter.logout();

    expect(tokenStorage.get()).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("clears local storage even when the revoke request fails", async () => {
    tokenStorage.set("t-1");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(djangoAuthAdapter.logout()).rejects.toThrow("network down");
    expect(tokenStorage.get()).toBeNull();
  });
});
