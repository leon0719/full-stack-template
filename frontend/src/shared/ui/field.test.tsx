import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FieldError } from "./field";

describe("FieldError", () => {
  it("translates a react-hook-form error whose message is an i18n key", () => {
    render(<FieldError errors={[{ message: "pages.demo.form.nameMin" }]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("至少 2 個字");
  });

  it("shows plain strings as-is and renders nothing without errors", () => {
    const { rerender } = render(<FieldError errors={[{ message: "必填" }]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("必填");
    rerender(<FieldError errors={[undefined]} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
