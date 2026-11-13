import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogHost, type ConfirmOptions, confirmDialog } from "./confirm-dialog";

function ask(options: ConfirmOptions) {
  let pending!: Promise<boolean>;
  act(() => {
    pending = confirmDialog(options);
  });
  return pending;
}

describe("confirmDialog", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves true on confirm, labelled by its title and described by the message", async () => {
    render(<ConfirmDialogHost />);
    const answer = ask({
      title: "刪除資料",
      message: "刪除後無法復原。",
      confirmLabel: "刪除",
      danger: true,
    });
    const dialog = await screen.findByRole("dialog", { name: "刪除資料" });
    expect(dialog).toHaveAccessibleDescription("刪除後無法復原。");
    await userEvent.click(screen.getByRole("button", { name: "刪除" }));
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("resolves false on cancel", async () => {
    render(<ConfirmDialogHost />);
    const answer = ask({ message: "確定嗎？" });
    await screen.findByRole("dialog", { name: "確定嗎？" });
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    await expect(answer).resolves.toBe(false);
  });

  it("resolves false on Esc (the dialog cancel event)", async () => {
    render(<ConfirmDialogHost />);
    const answer = ask({ message: "確定嗎？" });
    const dialog = await screen.findByRole("dialog");
    act(() => {
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    await expect(answer).resolves.toBe(false);
  });

  it("resolves false when the backdrop is clicked", async () => {
    render(<ConfirmDialogHost />);
    const answer = ask({ message: "確定嗎？" });
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(dialog);
    await expect(answer).resolves.toBe(false);
  });

  it("focuses cancel for dangerous actions, confirm otherwise, and restores focus afterwards", async () => {
    render(
      <>
        <button type="button">opener</button>
        <ConfirmDialogHost />
      </>,
    );
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    const first = ask({ message: "刪除？", danger: true });
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    await first;
    expect(opener).toHaveFocus();

    const second = ask({ message: "送出？", confirmLabel: "送出" });
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "送出" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "送出" }));
    await second;
  });

  it("cancels the previous request when a new one arrives", async () => {
    render(<ConfirmDialogHost />);
    const first = ask({ message: "第一個？" });
    await screen.findByRole("dialog", { name: "第一個？" });
    const second = ask({ message: "第二個？", confirmLabel: "好" });
    await expect(first).resolves.toBe(false);
    await screen.findByRole("dialog", { name: "第二個？" });
    await userEvent.click(screen.getByRole("button", { name: "好" }));
    await expect(second).resolves.toBe(true);
  });

  it("falls back to window.confirm when no host is mounted", async () => {
    const native = vi.spyOn(window, "confirm").mockReturnValue(true);
    await expect(confirmDialog({ message: "確定嗎？" })).resolves.toBe(true);
    expect(native).toHaveBeenCalledWith("確定嗎？");
  });
});
