import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/auth";
import { ApiError, apiDownload, apiGet, apiPatch, apiPost } from "./client";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

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
    useAuthStore.setState({ user: null, token: null, status: "idle" });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("performs a GET and returns parsed JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ id: 1 }));
    const data = await apiGet<{ id: number }>("/items/1");
    expect(data).toEqual({ id: 1 });
  });

  it("injects the Authorization header when a token exists", async () => {
    useAuthStore.setState({ token: "tok-123" });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({}));
    await apiGet("/me");
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok-123");
  });

  it("omits Authorization when no token exists", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({}));
    await apiGet("/public");
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBeNull();
  });

  it("does not leak the token to cross-origin absolute URLs", async () => {
    useAuthStore.setState({ token: "tok-123" });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({}));
    await apiGet("https://api.github.com/repos/facebook/react");
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBeNull();
  });

  it("attaches the token to same-origin absolute URLs", async () => {
    useAuthStore.setState({ token: "tok-123" });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({}));
    await apiGet(`${location.origin}/me`);
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok-123");
  });

  it("does not clear the session on a cross-origin 401", async () => {
    useAuthStore.setState({
      user: { id: "1", name: "admin", roles: ["admin"] },
      token: "tok",
      status: "authenticated",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } }),
    );
    await expect(apiGet("https://api.github.com/secure")).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().token).toBe("tok");
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
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({}));
    await apiPost("/items", { name: "x" });
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("sends a JSON body on POST", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ ok: true }));
    await apiPost("/items", { name: "x" });
    const init = spy.mock.calls[0][1] as RequestInit;
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
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ data: null, error: null }));
    await apiPatch("/items/1", { name: "y" });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ name: "y" }));
  });

  it("clears the auth session on 401", async () => {
    useAuthStore.setState({
      user: { id: "1", name: "admin", roles: ["admin"] },
      token: "tok",
      status: "authenticated",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } }),
    );
    await expect(apiGet("/secure")).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });

  it("sends FormData as-is and lets the browser set the multipart Content-Type", async () => {
    useAuthStore.setState({ token: "tok-123" });
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(ok({ data: { id: 1 }, error: null }));
    const form = new FormData();
    form.append("file", new File(["x"], "a.csv"));
    expect(await apiPost("/uploads", form)).toEqual({ id: 1 });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(form);
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBeNull();
    expect(headers.get("Authorization")).toBe("Bearer tok-123");
  });

  it("does not mark FormData passed via init.body as JSON", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({}));
    const form = new FormData();
    await apiPost("/uploads", undefined, { body: form });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(form);
    expect(new Headers(init.headers).get("Content-Type")).toBeNull();
  });
});

describe("apiDownload", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, token: "tok-123", status: "authenticated" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the blob and the RFC 5987 filename with the token attached", async () => {
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
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok-123");
  });

  it("returns a null filename when the header is missing and supports POST bodies", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 200 }));
    const { filename } = await apiDownload("/reports/export", {
      method: "POST",
      body: { year: 2026 },
    });
    expect(filename).toBeNull();
    const init = spy.mock.calls[0][1] as RequestInit;
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
