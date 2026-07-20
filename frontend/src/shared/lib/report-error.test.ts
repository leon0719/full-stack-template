import { afterEach, describe, expect, it, vi } from "vitest";
import { reportError, resetErrorReporterForTests, setErrorReporter } from "./report-error";

describe("reportError", () => {
  afterEach(() => {
    resetErrorReporterForTests();
    vi.restoreAllMocks();
  });

  it("logs to console.error by default", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportError(new Error("boom"));
    expect(spy).toHaveBeenCalled();
  });

  it("routes errors to a custom reporter with context", () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    const error = new Error("boom");
    reportError(error, { source: "test" });
    expect(reporter).toHaveBeenCalledWith(error, { source: "test" });
  });
});
