import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBlob, parseContentDispositionFilename } from "./download";

describe("parseContentDispositionFilename", () => {
  it("prefers the RFC 5987 UTF-8 filename* over filename", () => {
    const header =
      "attachment; filename=\"report.xlsx\"; filename*=UTF-8''%E5%A0%B1%E8%A1%A8%202026.xlsx";
    expect(parseContentDispositionFilename(header)).toBe("報表 2026.xlsx");
  });

  it("handles a lowercase charset and a language tag", () => {
    expect(parseContentDispositionFilename("attachment; filename*=utf-8'zh-TW'%E5%90%8D.csv")).toBe(
      "名.csv",
    );
  });

  it("decodes ISO-8859-1 filename*", () => {
    expect(parseContentDispositionFilename("attachment; filename*=ISO-8859-1''caf%E9.txt")).toBe(
      "café.txt",
    );
  });

  it("falls back to quoted and plain filename", () => {
    expect(parseContentDispositionFilename('attachment; filename="a \\"b\\".pdf"')).toBe(
      'a "b".pdf',
    );
    expect(parseContentDispositionFilename("attachment; filename=data.csv; size=10")).toBe(
      "data.csv",
    );
  });

  it("falls back to filename when filename* is malformed", () => {
    expect(
      parseContentDispositionFilename("attachment; filename*=UTF-8''%E5%ZZ; filename=\"ok.csv\""),
    ).toBe("ok.csv");
  });

  it("strips path segments and returns null when nothing usable is present", () => {
    expect(parseContentDispositionFilename('attachment; filename="../../etc/passwd"')).toBe(
      "passwd",
    );
    expect(parseContentDispositionFilename("inline")).toBeNull();
    expect(parseContentDispositionFilename(null)).toBeNull();
  });
});

describe("downloadBlob", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clicks a temporary download link and revokes the object URL afterwards", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:fake");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadBlob(new Blob(["x"]), "報表.csv");

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("報表.csv");
    expect(anchor.href).toBe("blob:fake");
    expect(anchor.isConnected).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:fake");
  });
});
