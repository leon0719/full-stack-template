import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster, toast } from "./toast";

describe("toast", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("announces messages in a pre-existing polite live region", () => {
    render(<Toaster />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();
    act(() => {
      toast.success("已儲存");
    });
    expect(region).toHaveTextContent("已儲存");
  });

  it("auto-dismisses after 4s, errors after 6s, and duration 0 stays", () => {
    render(<Toaster />);
    act(() => {
      toast.info("一般");
      toast.error("錯誤");
      toast("常駐", { duration: 0 });
    });
    const region = screen.getByRole("status");
    act(() => vi.advanceTimersByTime(4000));
    expect(region).not.toHaveTextContent("一般");
    expect(region).toHaveTextContent("錯誤");
    act(() => vi.advanceTimersByTime(2000));
    expect(region).not.toHaveTextContent("錯誤");
    act(() => vi.advanceTimersByTime(60_000));
    expect(region).toHaveTextContent("常駐");
  });

  it("a new toast does not restart the timers of existing ones", () => {
    render(<Toaster />);
    act(() => {
      toast("第一則");
    });
    act(() => vi.advanceTimersByTime(3000));
    act(() => {
      toast("第二則");
    });
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("status")).not.toHaveTextContent("第一則");
    expect(screen.getByRole("status")).toHaveTextContent("第二則");
  });

  it("can be dismissed with the close button", async () => {
    render(<Toaster />);
    act(() => {
      toast("可關閉", { duration: 0 });
    });
    await userEvent.click(screen.getByRole("button", { name: "關閉通知" }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("keeps at most three toasts, dropping the oldest", () => {
    render(<Toaster />);
    act(() => {
      for (const n of [1, 2, 3, 4]) toast(`訊息${n}`, { duration: 0 });
    });
    const region = screen.getByRole("status");
    expect(region).not.toHaveTextContent("訊息1");
    expect(region).toHaveTextContent("訊息4");
  });

  it("is a no-op when no Toaster is mounted", () => {
    expect(() => toast("沒有人接")).not.toThrow();
  });
});
