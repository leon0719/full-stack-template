import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "./field";
import { Input } from "./input";

describe("Field", () => {
  it("binds the label and the hint to the control", () => {
    render(
      <Field label="名稱" htmlFor="name" hint="最多 20 字" required>
        <Input id="name" />
      </Field>,
    );
    const input = screen.getByLabelText(/名稱/);
    expect(input).toHaveAccessibleDescription("最多 20 字");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("shows a plain-string error and marks the control invalid", () => {
    render(
      <Field label="名稱" htmlFor="name" error="必填">
        <Input id="name" />
      </Field>,
    );
    const input = screen.getByLabelText("名稱");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("必填");
    expect(screen.getByRole("alert")).toHaveTextContent("必填");
  });

  it("translates a react-hook-form error whose message is an i18n key", () => {
    render(
      <Field label="名稱" htmlFor="name" error={{ message: "pages.demo.form.nameMin" }}>
        <Input id="name" />
      </Field>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("至少 2 個字");
  });

  it("lets the child's own aria props win", () => {
    render(
      <Field label="名稱" htmlFor="name" error="必填">
        <Input id="name" aria-describedby="custom" />
      </Field>,
    );
    expect(screen.getByLabelText("名稱")).toHaveAttribute("aria-describedby", "custom");
  });
});
