import * as Sentry from "@sentry/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initErrorTracking } from "./error-tracking";
import { reportError, resetErrorReporterForTests } from "./report-error";

vi.mock("@sentry/react", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

// env 是在模組載入時 parse 好的常數,所以用 mock 覆寫整個 config 模組。
const { mockEnv } = vi.hoisted(() => ({ mockEnv: { sentryDsn: "", mode: "test", isProd: false } }));
vi.mock("@/shared/config", () => ({ env: mockEnv }));

afterEach(() => {
  resetErrorReporterForTests();
  vi.clearAllMocks();
  mockEnv.sentryDsn = "";
});

describe("initErrorTracking", () => {
  it("未設定 DSN 時完全不啟用 Sentry", () => {
    mockEnv.sentryDsn = "";
    initErrorTracking();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("設定 DSN 後會初始化 Sentry", () => {
    mockEnv.sentryDsn = "https://public@o0.ingest.sentry.io/1";
    initErrorTracking();
    expect(Sentry.init).toHaveBeenCalledOnce();
    expect(vi.mocked(Sentry.init).mock.calls[0][0]).toMatchObject({
      dsn: "https://public@o0.ingest.sentry.io/1",
      sendDefaultPii: false,
    });
  });

  it("啟用後 reportError 會送進 Sentry —— 這正是先前斷掉的那一段", () => {
    mockEnv.sentryDsn = "https://public@o0.ingest.sentry.io/1";
    initErrorTracking();

    const error = new Error("boom");
    reportError(error, { source: "test" });

    expect(Sentry.captureException).toHaveBeenCalledWith(error, { extra: { source: "test" } });
  });

  it("未設定 DSN 時 reportError 不會送到 Sentry", () => {
    mockEnv.sentryDsn = "";
    initErrorTracking();
    reportError(new Error("boom"));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("沒有 context 時不傳空的 extra", () => {
    mockEnv.sentryDsn = "https://public@o0.ingest.sentry.io/1";
    initErrorTracking();
    const error = new Error("boom");
    reportError(error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, undefined);
  });
});
