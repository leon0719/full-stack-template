import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/auth";
import {
  ApiError,
  apiDownload,
  apiGet,
  apiPatch,
  apiPost,
  CSRF_PATH,
  getCsrfToken,
  resetCsrfToken,
} from "./client";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const csrf = (token = "csrf-1") => ok({ data: { csrf_token: token }, error: null });

const csrfFailed = () =>
  new Response(
    JSON.stringify({
      data: null,
      error: { code: 403, message: "CSRF check failed", reason: "csrf_failed" },
    }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );

const unauthorized = () =>
  new Response(
    JSON.stringify({
      data: null,
      error: { code: 401, message: "Unauthorized", reason: "unauthenticated" },
    }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );

const initOf = (spy: { mock: { calls: unknown[][] } }, call: number) =>
  spy.mock.calls[call][1] as RequestInit;

const makeStorage = (): Storage => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
    key: () => null,
    get length() {
      return Object.keys(store).length;
    },
  } as Storage;
};

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
    useAuthStore.setState({ user: null, status: "idle" });
    resetCsrfToken();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("performs a GET and returns parsed JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ id: 1 }));
    const data = await apiGet<{ id: number }>("/items/1");
    expect(data).toEqual({ id: 1 });
  });

  it("never sends an Authorization header (the session is an HttpOnly cookie)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({}));
    await apiGet("/me");
    expect(new Headers(initOf(spy, 0).headers).get("Authorization")).toBeNull();
  });

  it("sends credentials and X-CSRFToken on API-origin POST", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf("csrf-1"))
      .mockResolvedValueOnce(ok({ data: { id: 1 }, error: null }));
    expect(await apiPost("/items", { name: "x" })).toEqual({ id: 1 });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0]).toBe(CSRF_PATH);
    expect(initOf(spy, 0).credentials).toBe("include");
    expect(spy.mock.calls[1][0]).toBe("/items");
    expect(initOf(spy, 1).credentials).toBe("include");
    expect(new Headers(initOf(spy, 1).headers).get("X-CSRFToken")).toBe("csrf-1");
  });

  it("caches the CSRF token across unsafe requests", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf("csrf-1"))
      .mockImplementation(() => Promise.resolve(ok({ data: null, error: null })));
    await apiPost("/a");
    await apiPatch("/b", { x: 1 });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls.filter(([url]) => url === CSRF_PATH)).toHaveLength(1);
    expect(new Headers(initOf(spy, 2).headers).get("X-CSRFToken")).toBe("csrf-1");
  });

  it("does not send credentials or CSRF to other origins", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({}));
    await apiPost("https://api.github.com/repos/facebook/react", { a: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    const init = initOf(spy, 0);
    expect(init.credentials).toBeUndefined();
    expect(new Headers(init.headers).get("X-CSRFToken")).toBeNull();
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
  });

  it("sends credentials and CSRF to same-origin absolute URLs", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf("csrf-1"))
      .mockResolvedValueOnce(ok({}));
    await apiPost(`${location.origin}/me`, {});
    expect(initOf(spy, 1).credentials).toBe("include");
    expect(new Headers(initOf(spy, 1).headers).get("X-CSRFToken")).toBe("csrf-1");
  });

  it("GET to API origin sends credentials but fetches no CSRF token", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({}));
    await apiGet("/me");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(initOf(spy, 0).credentials).toBe("include");
    expect(new Headers(initOf(spy, 0).headers).get("X-CSRFToken")).toBeNull();
  });

  it("refetches CSRF once on 403 csrf_failed then succeeds", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf("stale"))
      .mockResolvedValueOnce(csrfFailed())
      .mockResolvedValueOnce(csrf("fresh"))
      .mockResolvedValueOnce(ok({ data: { id: 2 }, error: null }));
    expect(await apiPost("/items", { name: "x" })).toEqual({ id: 2 });
    expect(spy.mock.calls.map(([url]) => url)).toEqual([CSRF_PATH, "/items", CSRF_PATH, "/items"]);
    expect(new Headers(initOf(spy, 1).headers).get("X-CSRFToken")).toBe("stale");
    expect(new Headers(initOf(spy, 3).headers).get("X-CSRFToken")).toBe("fresh");
    expect(initOf(spy, 3).body).toBe(JSON.stringify({ name: "x" }));
  });

  it("second consecutive csrf_failed throws ApiError (no loop)", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf("a"))
      .mockResolvedValueOnce(csrfFailed())
      .mockResolvedValueOnce(csrf("b"))
      .mockResolvedValueOnce(csrfFailed());
    const error = await apiPost("/items", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, reason: "csrf_failed" });
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("does not retry a 403 whose reason is not csrf_failed", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: null,
            error: { code: 403, message: "無權限", reason: "permission_denied" },
          }),
          { status: 403 },
        ),
      );
    await expect(apiPost("/items", {})).rejects.toMatchObject({ reason: "permission_denied" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("stale cookie: csrf_failed, refetch, retry, then 401 clears the store without more retries", async () => {
    useAuthStore.setState({
      user: { id: "1", name: "admin", roles: ["admin"] },
      status: "authenticated",
    });
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf("a"))
      .mockResolvedValueOnce(csrfFailed())
      .mockResolvedValueOnce(csrf("b"))
      .mockResolvedValueOnce(unauthorized());
    await expect(apiPost("/items", {})).rejects.toMatchObject({ status: 401 });
    expect(spy).toHaveBeenCalledTimes(4);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });

  it("a failing CSRF fetch rejects with ApiError, sends no write, and is not cached", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(csrf("ok"))
      .mockResolvedValueOnce(ok({ data: null, error: null }));
    await expect(apiPost("/items", {})).rejects.toBeInstanceOf(ApiError);
    expect(spy).toHaveBeenCalledTimes(1);
    await apiPost("/items", {});
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("rejects with ApiError when the CSRF response has no token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ data: {}, error: null }));
    await expect(getCsrfToken()).rejects.toBeInstanceOf(ApiError);
  });

  it("a network failure on the CSRF fetch rejects (no unhandled crash)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(apiPost("/items", {})).rejects.toBeInstanceOf(TypeError);
  });

  it("getCsrfToken dedupes concurrent calls and refetches after resetCsrfToken", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf("one"))
      .mockResolvedValueOnce(csrf("two"));
    expect(await Promise.all([getCsrfToken(), getCsrfToken()])).toEqual(["one", "one"]);
    expect(spy).toHaveBeenCalledTimes(1);
    resetCsrfToken();
    expect(await getCsrfToken()).toBe("two");
  });

  it("does not clear the session on a cross-origin 401", async () => {
    useAuthStore.setState({
      user: { id: "1", name: "admin", roles: ["admin"] },
      status: "authenticated",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } }),
    );
    await expect(apiGet("https://api.github.com/secure")).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().user).not.toBeNull();
    expect(useAuthStore.getState().status).toBe("authenticated");
  });

  it("omits Content-Type on a bodyless GET (avoids needless CORS preflight)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({}));
    await apiGet("/items");
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBeNull();
  });

  it("sets Content-Type: application/json when a body is present", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(ok({}));
    await apiPost("/items", { name: "x" });
    const headers = new Headers(initOf(spy, 1).headers);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("sends a JSON body on POST", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(ok({ ok: true }));
    await apiPost("/items", { name: "x" });
    const init = initOf(spy, 1);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "x" }));
  });

  it("throws ApiError with status and payload on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "nope" }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(apiGet("/bad")).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      payload: { message: "nope" },
    });
    expect((await apiGet("/bad").catch((e) => e)) instanceof ApiError).toBe(true);
  });

  it("reads message and reason from a BaseResponse error envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: null,
          error: { code: 409, message: "帳號重複", reason: "username_taken" },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(apiGet("/bad")).rejects.toMatchObject({
      status: 409,
      message: "帳號重複",
      reason: "username_taken",
    });
  });

  it("sets reason to null when the error has none", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 500, headers: { "Content-Type": "application/json" } }),
    );
    await expect(apiGet("/bad")).rejects.toMatchObject({ status: 500, reason: null });
  });

  it("unwraps BaseResponse data on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ data: { id: 1 }, error: null }));
    expect(await apiGet<{ id: number }>("/items/1")).toEqual({ id: 1 });
  });

  it("does not unwrap {data, error} shapes from other origins", async () => {
    const body = { data: { id: 1 }, error: null };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(body));
    expect(await apiGet("https://api.github.com/x")).toEqual(body);
  });

  it("sends PATCH with a JSON body", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(ok({ data: null, error: null }));
    await apiPatch("/items/1", { name: "y" });
    const init = initOf(spy, 1);
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ name: "y" }));
  });

  it("401 from API clears the auth store", async () => {
    useAuthStore.setState({
      user: { id: "1", name: "admin", roles: ["admin"] },
      status: "authenticated",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } }),
    );
    await expect(apiGet("/secure")).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });

  it("sends FormData as-is and lets the browser set the multipart Content-Type", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf("csrf-1"))
      .mockResolvedValueOnce(ok({ data: { id: 1 }, error: null }));
    const form = new FormData();
    form.append("file", new File(["x"], "a.csv"));
    expect(await apiPost("/uploads", form)).toEqual({ id: 1 });
    const init = initOf(spy, 1);
    expect(init.body).toBe(form);
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBeNull();
    expect(headers.get("X-CSRFToken")).toBe("csrf-1");
  });

  it("does not mark FormData passed via init.body as JSON", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(ok({}));
    const form = new FormData();
    await apiPost("/uploads", undefined, { body: form });
    const init = initOf(spy, 1);
    expect(init.body).toBe(form);
    expect(new Headers(init.headers).get("Content-Type")).toBeNull();
  });
});

describe("apiDownload", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, status: "authenticated" });
    resetCsrfToken();
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the blob and the RFC 5987 filename with credentials attached", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("a,b\n1,2", {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition":
            "attachment; filename=\"export.csv\"; filename*=UTF-8''%E5%8C%AF%E5%87%BA.csv",
        },
      }),
    );
    const { blob, filename } = await apiDownload("/reports/export");
    expect(filename).toBe("匯出.csv");
    expect(await blob.text()).toBe("a,b\n1,2");
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
  });

  it("returns a null filename when the header is missing and supports POST bodies", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(csrf("csrf-1"))
      .mockResolvedValueOnce(new Response("x", { status: 200 }));
    const { filename } = await apiDownload("/reports/export", {
      method: "POST",
      body: { year: 2026 },
    });
    expect(filename).toBeNull();
    const init = initOf(spy, 1);
    expect(new Headers(init.headers).get("X-CSRFToken")).toBe("csrf-1");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ year: 2026 }));
  });

  it("throws ApiError with the parsed envelope on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: null,
          error: { code: 403, message: "無權限", reason: "forbidden" },
        }),
        { status: 403 },
      ),
    );
    await expect(apiDownload("/reports/export")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      reason: "forbidden",
    });
  });
});
