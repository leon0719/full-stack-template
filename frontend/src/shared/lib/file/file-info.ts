/** 人看得懂的檔案大小:512 B、1.5 KB、12.3 MB */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * 檔案是否符合 `<input accept>` 的寫法(逗號分隔):副檔名 `.csv`、MIME `image/png`、萬用 `image/*`。
 * 拖放進來的檔案不受 accept 屬性限制,要自己再檢查一次;accept 為空字串代表不限制。
 * 注意這只是 UX 檢查(副檔名/MIME 都能偽造),真正的檔案驗證在後端。
 */
export function matchesAccept(file: File, accept: string | undefined): boolean {
  const rules = (accept ?? "")
    .split(",")
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith(".")) return name.endsWith(rule);
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}
