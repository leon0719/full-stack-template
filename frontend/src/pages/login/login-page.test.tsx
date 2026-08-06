// src/pages/login/login-page.test.tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAuthAdapter, setAuthAdapter } from "@/shared/auth";

let searchParams: { error?: string } = {};
vi.mock("@tanstack/react-router", () => ({
  useSearch: () => searchParams,
}));

import { LoginPage } from "./ui/login-page";

describe("LoginPage", () => {
  beforeEach(() => {
    setAuthAdapter(fakeAuthAdapter);
    searchParams = {};
  });

  it("renders a LINE login link built from the adapter", () => {
    render(<LoginPage />);
    const link = screen.getByRole("link", { name: /line/i });
    expect(link).toHaveAttribute("href", "/login/callback?code=fake-code-user");
  });

  it("shows an error message when redirected back with ?error=", () => {
    searchParams = { error: "line_auth_failed" };
    render(<LoginPage />);
    expect(screen.getByText(/登入失敗|failed/i)).toBeInTheDocument();
  });

  it("shows no error message without ?error=", () => {
    render(<LoginPage />);
    expect(screen.queryByText(/登入失敗|failed/i)).not.toBeInTheDocument();
  });
});
