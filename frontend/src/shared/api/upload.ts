import { parseText, resolveUrl, settle, tokenFor } from "./client";

export interface UploadProgress {
  loaded: number;
  /** 瀏覽器無法得知總大小時為 null */
  total: number | null;
  /** 0–100;total 未知時為 null */
  percent: number | null;
}

export interface UploadOptions {
  method?: "POST" | "PUT" | "PATCH";
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * 需要「上傳進度」時用的 XHR 版上傳;不需要進度直接 `apiPost(path, formData)` 即可。
 *
 * 為什麼不用 fetch:fetch 沒有上傳進度事件。用 ReadableStream 當 request body 自己數 bytes
 * 需要 `duplex: "half"` + HTTP/2,而且 Safari / Firefox 不支援串流上傳,所以這裡用 XHR 的
 * `upload.onprogress`。token、錯誤(ApiError、自家 401 清 session)、envelope 解包規則與 apiPost 相同。
 *
 * ```ts
 * const form = new FormData();
 * form.append("file", file);
 * const result = await apiUpload<UploadResult>("/uploads", form, {
 *   onProgress: ({ percent }) => setPercent(percent ?? 0),
 *   signal: controller.signal,
 * });
 * ```
 * 取消:`signal` abort 後 Promise 以 `DOMException("AbortError")` reject。
 */
export function apiUpload<T>(
  path: string,
  body: FormData,
  options: UploadOptions = {},
): Promise<T> {
  const method = options.method ?? "POST";
  const url = resolveUrl(path);

  return new Promise<T>((resolve, reject) => {
    const abortError = () => new DOMException("Upload aborted", "AbortError");
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }
    const token = tokenFor(url);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    const onAbort = () => xhr.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => options.signal?.removeEventListener("abort", onAbort);

    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable ? event.total : null;
      options.onProgress?.({
        loaded: event.loaded,
        total,
        percent: total ? Math.round((event.loaded / total) * 100) : null,
      });
    };
    xhr.onload = () => {
      cleanup();
      try {
        resolve(settle(method, path, url, xhr.status, parseText(xhr.responseText)) as T);
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => {
      cleanup();
      // 與 fetch 一致:網路層失敗(斷線、CORS)是 TypeError,不是 ApiError
      reject(new TypeError(`${method} ${path} network error`));
    };
    xhr.onabort = () => {
      cleanup();
      reject(abortError());
    };
    xhr.send(body);
  });
}
