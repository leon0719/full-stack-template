export interface CompressImageOptions {
  /** 長邊上限(px),預設 2000 */
  maxEdge?: number;
  /** 0–1,預設 0.85 */
  quality?: number;
  /** 小於這個大小(bytes)就不壓,預設 1 MB */
  skipBelow?: number;
  /** 輸出格式,預設 image/jpeg(相容性最好);要保留透明可用 image/webp */
  type?: "image/jpeg" | "image/webp";
}

const EXTENSIONS = { "image/jpeg": "jpg", "image/webp": "webp" } as const;

/**
 * 上傳前用 canvas 把圖片縮到長邊 maxEdge、重新編碼:上傳快、後端與縮圖省流量。
 * 失敗一律回傳原檔(由後端決定收不收),不會丟錯:
 * 不是圖片、瀏覽器解不開(例如非 Safari 的 HEIC)、沒有 canvas、壓完反而沒變小。
 * 註:重新編碼會去掉 EXIF(含 GPS);createImageBitmap 已依 EXIF 方向轉正。
 */
export async function compressImage(file: File, options: CompressImageOptions = {}): Promise<File> {
  const { maxEdge = 2000, quality = 0.85, skipBelow = 1024 * 1024, type = "image/jpeg" } = options;
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml")
    return file;
  if (file.size <= skipBelow || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    if (type === "image/jpeg") {
      // JPEG 沒有透明:先鋪白底,透明 PNG 才不會變黑
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob || blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.${EXTENSIONS[type]}`, {
      type,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
