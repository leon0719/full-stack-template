import { describe, expect, it } from "vitest";
import { formatFileSize, matchesAccept } from "./file-info";

describe("formatFileSize", () => {
  it("picks a readable unit", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("matchesAccept", () => {
  const csv = new File(["a"], "Report.CSV", { type: "text/csv" });
  const png = new File(["a"], "photo.png", { type: "image/png" });

  it("accepts anything when accept is empty", () => {
    expect(matchesAccept(csv, "")).toBe(true);
    expect(matchesAccept(csv, undefined)).toBe(true);
  });

  it("matches extensions case-insensitively", () => {
    expect(matchesAccept(csv, ".xlsx, .csv")).toBe(true);
    expect(matchesAccept(png, ".xlsx,.csv")).toBe(false);
  });

  it("matches exact and wildcard MIME types", () => {
    expect(matchesAccept(png, "image/*")).toBe(true);
    expect(matchesAccept(png, "image/jpeg")).toBe(false);
    expect(matchesAccept(csv, "text/csv")).toBe(true);
  });
});
