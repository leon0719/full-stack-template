import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Field } from "./field";
import { FileDropzone } from "./file-dropzone";

const csv = (name = "a.csv", size = 10) =>
  new File([new Uint8Array(size)], name, { type: "text/csv" });

function input() {
  return screen.getByTestId("file-dropzone-input") as HTMLInputElement;
}

describe("FileDropzone", () => {
  it("is a keyboard-focusable button that opens the file picker", async () => {
    render(<FileDropzone onFiles={vi.fn()} accept=".csv,.xlsx" maxSize={1024 * 1024} />);
    const zone = screen.getByRole("button", { name: /拖曳檔案到這裡/ });
    expect(zone).toHaveAccessibleDescription("支援格式：.csv / .xlsx · 單檔上限 1.0 MB");
    const click = vi.spyOn(input(), "click");
    zone.focus();
    await userEvent.keyboard("{Enter}");
    expect(click).toHaveBeenCalled();
  });

  it("passes picked files through and resets the input so the same file can be picked again", async () => {
    const onFiles = vi.fn();
    render(<FileDropzone onFiles={onFiles} accept=".csv" />);
    const file = csv();
    await userEvent.upload(input(), file);
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(input().value).toBe("");
  });

  it("accepts dropped files and rejects ones with the wrong type or size", () => {
    const onFiles = vi.fn();
    render(<FileDropzone onFiles={onFiles} accept=".csv" maxSize={100} multiple />);
    const good = csv("ok.csv");
    const wrong = new File(["x"], "photo.png", { type: "image/png" });
    const big = csv("big.csv", 500);
    fireEvent.drop(screen.getByRole("button"), { dataTransfer: { files: [good, wrong, big] } });
    expect(onFiles).toHaveBeenCalledWith([good]);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("「photo.png」格式不符，僅支援 .csv");
    expect(alert).toHaveTextContent("「big.csv」超過 100 B 上限");
    expect(screen.getByRole("button")).toHaveAttribute("aria-invalid", "true");
  });

  it("rejects several files when multiple is off, and too many files when maxFiles is set", () => {
    const onFiles = vi.fn();
    const { rerender } = render(<FileDropzone onFiles={onFiles} />);
    fireEvent.drop(screen.getByRole("button"), { dataTransfer: { files: [csv(), csv()] } });
    expect(screen.getByRole("alert")).toHaveTextContent("一次只能選一個檔案");

    rerender(<FileDropzone onFiles={onFiles} multiple maxFiles={2} />);
    fireEvent.drop(screen.getByRole("button"), {
      dataTransfer: { files: [csv(), csv(), csv()] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("一次最多只能選 2 個檔案");
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("ignores drops while disabled", () => {
    const onFiles = vi.fn();
    render(<FileDropzone onFiles={onFiles} disabled />);
    fireEvent.drop(screen.getByRole("button"), { dataTransfer: { files: [csv()] } });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("works inside Field: label names the zone and the field error describes it", () => {
    render(
      <Field label="匯入檔案" htmlFor="import" error="請選擇檔案">
        <FileDropzone id="import" onFiles={vi.fn()} />
      </Field>,
    );
    const zone = screen.getByRole("button", { name: /匯入檔案/ });
    expect(zone).toHaveAttribute("aria-invalid", "true");
    expect(zone).toHaveAccessibleDescription(/請選擇檔案/);
  });
});
