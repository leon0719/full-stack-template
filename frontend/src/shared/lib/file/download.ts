/**
 * 用暫時的 <a download> 觸發瀏覽器下載記憶體中的 Blob。
 * 搭配 `apiDownload()`(`@/shared/api`)下載後端匯出檔:
 * `const { blob, filename } = await apiDownload("/reports/export"); downloadBlob(blob, filename ?? "report.xlsx");`
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  // Firefox 要求 <a> 在 DOM 裡才會觸發下載
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 同步 revoke 會讓 Safari / Firefox 在下載開始前就拿不到 blob
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * 從 `Content-Disposition` 取出檔名;沒有就回傳 null。
 * 優先用 RFC 5987/6266 的 `filename*=UTF-8''%E5%A0%B1...`(中文檔名靠它),
 * 其次才是 `filename="..."` / `filename=...`。
 */
export function parseContentDispositionFilename(header: string | null | undefined): string | null {
  if (!header) return null;

  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (extended) {
    const charset = extended[1].trim().toLowerCase();
    const encoded = extended[2].trim().replace(/^"(.*)"$/, "$1");
    try {
      if (charset === "" || charset === "utf-8")
        return sanitizeFilename(decodeURIComponent(encoded));
      // ISO-8859-1 等其他 charset:每個 %XX 就是一個字元
      return sanitizeFilename(
        encoded.replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        ),
      );
    } catch {
      // 編碼壞掉就退回一般 filename
    }
  }

  const quoted = /filename\s*=\s*"((?:\\.|[^"\\])*)"/i.exec(header);
  if (quoted) return sanitizeFilename(quoted[1].replace(/\\(.)/g, "$1"));

  const plain = /filename\s*=\s*([^;]+)/i.exec(header);
  if (plain) return sanitizeFilename(plain[1].trim());

  return null;
}

// 檔名只取最後一段,去掉路徑分隔字元,避免後端回傳 "../x" 之類的值
function sanitizeFilename(name: string): string | null {
  const base = name.split(/[\\/]/).pop()?.trim() ?? "";
  return base === "" ? null : base;
}
