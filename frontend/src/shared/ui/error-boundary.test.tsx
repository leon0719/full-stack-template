import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetErrorReporterForTests, setErrorReporter } from "@/shared/lib/report-error";
import { ErrorBoundary } from "./error-boundary";

function Boom(): never {
  throw new Error("boom");
}

// 元件要定義在模組層(Biome noComponentHookFactories);是否丟錯由測試切換這個旗標控制。
let flakyShouldThrow = true;

function Flaky() {
  if (flakyShouldThrow) throw new Error("boom");
  return <p>recovered</p>;
}

describe("ErrorBoundary", () => {
  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <p>safe</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("safe")).toBeInTheDocument();
  });

  it("renders the fallback when a child throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("發生錯誤")).toBeInTheDocument();
  });

  it("reports the caught error through the pluggable reporter", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reporter = vi.fn();
    setErrorReporter(reporter);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(reporter).toHaveBeenCalled();
    expect((reporter.mock.calls[0][0] as Error).message).toBe("boom");
    resetErrorReporterForTests();
  });

  it("recovers when the retry button is pressed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    flakyShouldThrow = true;
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByText("發生錯誤")).toBeInTheDocument();
    flakyShouldThrow = false;
    await userEvent.click(screen.getByRole("button", { name: "重試" }));
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
