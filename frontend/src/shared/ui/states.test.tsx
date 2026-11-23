import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Badge } from "./badge";
import { ErrorState } from "./error-state";
import { Spinner } from "./spinner";

describe("ErrorState", () => {
  it("is an alert with default copy and a retry button", async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("發生錯誤");
    await userEvent.click(screen.getByRole("button", { name: "重試" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("uses the given description and hides retry without a handler", () => {
    render(<ErrorState title="載入失敗" description="伺服器沒有回應" />);
    expect(screen.getByRole("alert")).toHaveTextContent("載入失敗伺服器沒有回應");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Spinner", () => {
  it("announces loading by default and can be decorative", () => {
    const { rerender } = render(<Spinner />);
    expect(screen.getByRole("status", { name: "載入中…" })).toBeInTheDocument();
    rerender(<Spinner label="" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("Badge", () => {
  it("has the template's status variants", () => {
    render(<Badge variant="success">已完成</Badge>);
    expect(screen.getByText("已完成")).toHaveClass("text-success");
  });
});
