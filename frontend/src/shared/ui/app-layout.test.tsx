import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Outlet: () => <div>outlet</div>,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

import { useAuthStore } from "@/shared/auth";
import { AppLayout } from "./app-layout";

describe("AppLayout", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, token: null, status: "unauthenticated" });
  });

  it("renders the outlet", () => {
    render(<AppLayout />);
    expect(screen.getByText("outlet")).toBeInTheDocument();
  });

  it("always renders the language switcher", () => {
    render(<AppLayout />);
    expect(screen.getByRole("combobox", { name: /language/i })).toBeInTheDocument();
  });

  it("shows the user name and a logout link when authenticated", () => {
    useAuthStore.setState({
      user: { id: "1", name: "admin", roles: ["admin"] },
      token: "t",
      status: "authenticated",
    });
    render(<AppLayout />);
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /logout|登出/i })).toHaveAttribute("href", "/logout");
  });

  it("hides the logout link when not authenticated", () => {
    render(<AppLayout />);
    expect(screen.queryByRole("link", { name: /logout|登出/i })).not.toBeInTheDocument();
  });
});
