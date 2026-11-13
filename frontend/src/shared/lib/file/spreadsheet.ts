/** 失敗原因,可直接當 i18n key:`common.spreadsheet.<reason>` */
export type SpreadsheetErrorReason = "unsupportedFormat" | "unreadable";

export class SpreadsheetError extends Error {
  readonly reason: SpreadsheetErrorReason;
  constructor(reason: SpreadsheetErrorReason, options?: { cause?: unknown }) {
    super(`spreadsheet: ${reason}`, options);
    this.name = "SpreadsheetError";
    this.reason = reason;
  }
}

export interface ColumnValidationResult {
  valid: boolean;
  /** 檔案第一列(已 trim) */
  headers: string[];
  /** 缺少的必要欄位,依 required 的順序 */
  missing: string[];
}

// 標題列一定在檔案開頭;只讀前 64 KB,大檔也不用整份載入記憶體
const CSV_HEAD_BYTES = 64 * 1024;

function extensionOf(file: File): string {
  return file.name.toLowerCase().split(".").pop() ?? "";
}

/**
 * 讀出試算表第一列(標題列)。支援 `.csv`(UTF-8,解不開時改用 Big5)與 `.xlsx`(第一個工作表)。
 * `.xls`(舊版二進位格式)與其他格式丟 `SpreadsheetError("unsupportedFormat")`。
 */
export async function readSpreadsheetHeaders(file: File): Promise<string[]> {
  const ext = extensionOf(file);
  if (ext === "csv") return readCsvHeaders(file);
  if (ext === "xlsx") return readXlsxHeaders(file);
  throw new SpreadsheetError("unsupportedFormat");
}

/**
 * 上傳前檢查必要欄位,讓使用者不用等後端回錯。只是 UX 檢查,後端仍要自己驗。
 * ```ts
 * const { valid, missing } = await validateColumns(file, ["姓名", "Email"]);
 * if (!valid) setError(t("common.spreadsheet.missingColumns", { columns: missing.join("、") }));
 * ```
 */
export async function validateColumns(
  file: File,
  required: readonly string[],
): Promise<ColumnValidationResult> {
  const headers = await readSpreadsheetHeaders(file);
  const present = new Set(headers);
  const missing = required.filter((column) => !present.has(column.trim()));
  return { valid: missing.length === 0, headers, missing };
}

async function readCsvHeaders(file: File): Promise<string[]> {
  let buffer: ArrayBuffer;
  try {
    buffer = await file.slice(0, CSV_HEAD_BYTES).arrayBuffer();
  } catch (cause) {
    throw new SpreadsheetError("unreadable", { cause });
  }
  return parseCsvHeaderRow(decodeCsv(buffer));
}

// Excel「CSV(逗號分隔)」在繁中 Windows 存成 Big5(CP950),「CSV UTF-8」才是 UTF-8 + BOM。
// 先用 UTF-8 嚴格解碼,失敗才退回 Big5。stream: true 讓被 64 KB 截斷的半個字元不算錯誤。
function decodeCsv(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer, { stream: true });
  } catch {
    return new TextDecoder("big5").decode(buffer, { stream: true });
  }
}

/** 解析 CSV 第一筆紀錄:支援雙引號包住的逗號、換行與 `""` 跳脫;會去掉 BOM 與前後空白 */
export function parseCsvHeaderRow(text: string): string[] {
  const source = text.replace(/^﻿/, "");
  if (source.trim() === "") return [];
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inQuotes) {
      if (ch !== '"') cell += ch;
      else if (source[i + 1] === '"') {
        cell += '"';
        i++;
      } else inQuotes = false;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") break;
    else cell += ch;
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

// read-excel-file 只在真的讀 xlsx 時才載入(動態 import 拆成獨立 chunk,不進主 bundle)。
// 不用 npm 的 `xlsx`:npm 上停在 0.18.5,有已知漏洞且不再更新。
async function readXlsxHeaders(file: File): Promise<string[]> {
  try {
    const { readSheet } = await import("read-excel-file/browser");
    const rows = await readSheet(file);
    return (rows[0] ?? []).map((value) => (value === null ? "" : String(value).trim()));
  } catch (cause) {
    throw new SpreadsheetError("unreadable", { cause });
  }
}
