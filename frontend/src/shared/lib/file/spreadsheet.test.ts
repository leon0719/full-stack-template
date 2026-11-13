import { afterEach, describe, expect, it, vi } from "vitest";

const readSheet = vi.fn();
vi.mock("read-excel-file/browser", () => ({ readSheet }));

import {
  parseCsvHeaderRow,
  readSpreadsheetHeaders,
  SpreadsheetError,
  validateColumns,
} from "./spreadsheet";

function csv(content: BlobPart, name = "data.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

describe("parseCsvHeaderRow", () => {
  it("handles quotes, escaped quotes, embedded commas and newlines", () => {
    expect(parseCsvHeaderRow('id, "name, full" ,"say ""hi""","multi\nline"\n1,2,3,4')).toEqual([
      "id",
      "name, full",
      'say "hi"',
      "multi\nline",
    ]);
  });

  it("strips the BOM, stops at CRLF and returns [] for empty input", () => {
    expect(parseCsvHeaderRow("﻿姓名,Email\r\n王小明,a@b.c")).toEqual(["姓名", "Email"]);
    expect(parseCsvHeaderRow("")).toEqual([]);
  });
});

describe("readSpreadsheetHeaders", () => {
  afterEach(() => readSheet.mockReset());

  it("reads a UTF-8 CSV header", async () => {
    expect(await readSpreadsheetHeaders(csv("﻿姓名,Email\n王小明,a@b.c"))).toEqual([
      "姓名",
      "Email",
    ]);
  });

  it("falls back to Big5 for CSV saved by Excel on Traditional Chinese Windows", async () => {
    // 「姓名,Email」的 Big5 編碼
    const big5 = new Uint8Array([0xa9, 0x6d, 0xa6, 0x57, 0x2c, 0x45, 0x6d, 0x61, 0x69, 0x6c]);
    expect(await readSpreadsheetHeaders(csv(big5))).toEqual(["姓名", "Email"]);
  });

  it("reads the first row of an xlsx through read-excel-file", async () => {
    readSheet.mockResolvedValue([
      [" 姓名 ", "Email", null, 2026],
      ["王小明", "a@b.c", null, 1],
    ]);
    const file = new File(["zip"], "名單.XLSX");
    expect(await readSpreadsheetHeaders(file)).toEqual(["姓名", "Email", "", "2026"]);
    expect(readSheet).toHaveBeenCalledWith(file);
  });

  it("wraps xlsx parse failures as unreadable", async () => {
    readSheet.mockRejectedValue(new Error("not a zip"));
    await expect(readSpreadsheetHeaders(new File(["x"], "a.xlsx"))).rejects.toMatchObject({
      name: "SpreadsheetError",
      reason: "unreadable",
    });
  });

  it("rejects unsupported formats such as legacy .xls", async () => {
    const error = await readSpreadsheetHeaders(new File(["x"], "old.xls")).catch((e) => e);
    expect(error).toBeInstanceOf(SpreadsheetError);
    expect(error.reason).toBe("unsupportedFormat");
  });
});

describe("validateColumns", () => {
  it("reports missing required columns in the given order", async () => {
    const result = await validateColumns(csv("Email,電話\n"), ["姓名", "Email", "地址"]);
    expect(result).toEqual({ valid: false, headers: ["Email", "電話"], missing: ["姓名", "地址"] });
  });

  it("is valid when every required column exists", async () => {
    const result = await validateColumns(csv("姓名,Email,其他\n"), ["Email", "姓名"]);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
