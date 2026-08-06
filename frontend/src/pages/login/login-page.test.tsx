// src/pages/login/login-page.test.tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeAuthAdapter, setAuthAdapter } from "@/shared/auth";
import { LoginPage } from "./ui/login-page";

describe("LoginPage", () => {
  beforeEach(() => {
    setAuthAdapter(fakeAuthAdapter);
  });

  it("renders a LINE login link built from the adapter", () => {
    render(<LoginPage />);
    const link = screen.getByRole("link", { name: /line/i });
    expect(link).toHaveAttribute("href", "/login/callback?code=fake-code-user");
  });
});
