import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/shared/i18n";
import { formatDate, formatDateTime, formatRelativeTime } from "./format-time";

describe("formatDateTime / formatDate", () => {
  afterEach(async () => {
    await i18n.changeLanguage("zh-TW");
  });

  it("converts UTC to Taipei time regardless of the machine time zone", () => {
    expect(formatDateTime("2026-11-13T06:05:00Z")).toBe("2026/11/13 14:05");
  });

  it("puts a UTC evening on the next Taipei day", () => {
    expect(formatDate("2026-11-13T16:30:00Z")).toBe("2026/11/14");
  });

  it("follows the current i18n language", async () => {
    await i18n.changeLanguage("en");
    expect(formatDateTime("2026-11-13T06:05:00Z")).toBe("11/13/2026, 14:05");
  });

  it("can include seconds and accepts an explicit locale", () => {
    expect(
      formatDateTime(Date.UTC(2026, 10, 13, 6, 5, 9), { withSeconds: true, locale: "zh-TW" }),
    ).toBe("2026/11/13 14:05:09");
  });

  it("returns an empty string for null, undefined and invalid input", () => {
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime(undefined)).toBe("");
    expect(formatDate("not a date")).toBe("");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-11-13T06:00:00Z");

  it("says now within 45 seconds", () => {
    expect(formatRelativeTime("2026-11-13T05:59:30Z", { now, locale: "en" })).toBe("now");
  });

  it("formats past and future in the given locale", () => {
    expect(formatRelativeTime("2026-11-13T05:57:00Z", { now, locale: "zh-TW" })).toBe("3 分鐘前");
    expect(formatRelativeTime("2026-11-13T08:00:00Z", { now, locale: "en" })).toBe("in 2 hours");
    expect(formatRelativeTime("2026-11-11T06:00:00Z", { now, locale: "en" })).toBe("2 days ago");
  });

  it("falls back to the date after 30 days", () => {
    expect(formatRelativeTime("2026-09-01T06:00:00Z", { now, locale: "zh-TW" })).toBe("2026/09/01");
  });
});
