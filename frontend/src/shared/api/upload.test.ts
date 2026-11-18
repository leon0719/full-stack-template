import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/auth";
import { ApiError, CSRF_PATH, getCsrfToken, resetCsrfToken } from "./client";
import { apiUpload } from "./upload";

const csrf = (token = "csrf-1") =>
  new Response(JSON.stringify({ data: { csrf_token: token }, error: null }), { status: 200 });

class FakeXhr {
  static last: FakeXhr | undefined;
  withCredentials = false;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  responseText = "";
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
  progress(loaded: number, total: number, lengthComputable = true) {
    this.upload.onprogress?.({ loaded, total, lengthComputable } as ProgressEvent);
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

// API 來源要先等 CSRF token,XHR 稍後才建立
const xhrReady = () =>
  vi.waitFor(() => {
    if (!FakeXhr.last) throw new Error("xhr not created yet");
    return FakeXhr.last;
  });

describe("apiUpload", () => {
  beforeEach(() => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    FakeXhr.last = undefined;
    resetCsrfToken();
    useAuthStore.setState({ user: null, status: "authenticated" });
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(csrf()));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts the FormData with cookie credentials and CSRF, reports progress and unwraps the envelope", async () => {
    const form = new FormData();
    const onProgress = vi.fn();
    const pending = apiUpload<{ id: number }>("/uploads", form, { onProgress });
    const xhr = await xhrReady();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      CSRF_PATH,
      expect.objectContaining({ credentials: "include" }),
    );
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/uploads");
    expect(xhr.body).toBe(form);
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers["X-CSRFToken"]).toBe("csrf-1");
    expect(xhr.headers.Authorization).toBeUndefined();
    expect(xhr.headers["Content-Type"]).toBeUndefined();

    xhr.progress(25, 100);
    xhr.progress(10, 0, false);
    expect(onProgress).toHaveBeenNthCalledWith(1, { loaded: 25, total: 100, percent: 25 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { loaded: 10, total: null, percent: null });

    xhr.respond(201, { data: { id: 7 }, error: null });
    await expect(pending).resolves.toEqual({ id: 7 });
  });

  it("rejects with ApiError and clears the session on 401", async () => {
    useAuthStore.setState({
      user: { id: "1", name: "admin", roles: ["admin"] },
      status: "authenticated",
    });
    const pending = apiUpload("/uploads", new FormData(), { method: "PUT" });
    const xhr = await xhrReady();
    expect(xhr.method).toBe("PUT");
    xhr.respond(401, {
      data: null,
      error: { code: 401, message: "過期", reason: "expired" },
    });
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).reason).toBe("expired");
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("does not retry csrf_failed but drops the cached token so the next write refetches", async () => {
    const pending = apiUpload("/uploads", new FormData());
    const xhr = await xhrReady();
    xhr.respond(403, {
      data: null,
      error: { code: 403, message: "CSRF check failed", reason: "csrf_failed" },
    });
    await expect(pending).rejects.toMatchObject({ status: 403, reason: "csrf_failed" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await getCsrfToken();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("aborts through the AbortSignal", async () => {
    const controller = new AbortController();
    const pending = apiUpload("/uploads", new FormData(), { signal: controller.signal });
    const xhr = await xhrReady();
    controller.abort();
    expect(xhr.withCredentials).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects with AbortError when aborted before the CSRF token arrives", async () => {
    const controller = new AbortController();
    const pending = apiUpload("/uploads", new FormData(), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXhr.last).toBeUndefined();
  });

  it("rejects network failures as TypeError", async () => {
    const pending = apiUpload("/uploads", new FormData());
    const xhr = await xhrReady();
    xhr.onerror?.();
    await expect(pending).rejects.toBeInstanceOf(TypeError);
  });

  it("rejects with ApiError when the CSRF fetch fails and creates no XHR", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("{}", { status: 500 })),
    );
    await expect(apiUpload("/uploads", new FormData())).rejects.toBeInstanceOf(ApiError);
    expect(FakeXhr.last).toBeUndefined();
  });

  it("sends neither credentials nor CSRF to another origin", () => {
    void apiUpload("https://storage.example.com/put", new FormData()).catch(() => {});
    const xhr = FakeXhr.last;
    expect(xhr?.withCredentials).toBe(false);
    expect(xhr?.headers["X-CSRFToken"]).toBeUndefined();
    expect(xhr?.headers.Authorization).toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
