import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/auth";
import { ApiError } from "./client";
import { apiUpload } from "./upload";

class FakeXhr {
  static last: FakeXhr;
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

describe("apiUpload", () => {
  beforeEach(() => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    useAuthStore.setState({ user: null, token: "tok-123", status: "authenticated" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("posts the FormData with the token, reports progress and unwraps the envelope", async () => {
    const form = new FormData();
    const onProgress = vi.fn();
    const pending = apiUpload<{ id: number }>("/uploads", form, { onProgress });
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/uploads");
    expect(xhr.body).toBe(form);
    expect(xhr.headers.Authorization).toBe("Bearer tok-123");
    expect(xhr.headers["Content-Type"]).toBeUndefined();

    xhr.progress(25, 100);
    xhr.progress(10, 0, false);
    expect(onProgress).toHaveBeenNthCalledWith(1, { loaded: 25, total: 100, percent: 25 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { loaded: 10, total: null, percent: null });

    xhr.respond(201, { data: { id: 7 }, error: null });
    await expect(pending).resolves.toEqual({ id: 7 });
  });

  it("rejects with ApiError and clears the session on 401", async () => {
    const pending = apiUpload("/uploads", new FormData(), { method: "PUT" });
    expect(FakeXhr.last.method).toBe("PUT");
    FakeXhr.last.respond(401, {
      data: null,
      error: { code: 401, message: "過期", reason: "expired" },
    });
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).reason).toBe("expired");
    expect(useAuthStore.getState().token).toBeNull();
  });

  it("aborts through the AbortSignal", async () => {
    const controller = new AbortController();
    const pending = apiUpload("/uploads", new FormData(), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects network failures as TypeError", async () => {
    const pending = apiUpload("/uploads", new FormData());
    FakeXhr.last.onerror?.();
    await expect(pending).rejects.toBeInstanceOf(TypeError);
  });

  it("does not send the token to another origin", () => {
    void apiUpload("https://storage.example.com/put", new FormData()).catch(() => {});
    expect(FakeXhr.last.headers.Authorization).toBeUndefined();
  });
});
