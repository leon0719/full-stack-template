import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Navigate: ({ to }: { to: string }) => <div>redirect:{to}</div>,
}));

import { useAuthStore } from "../model/auth-store";
import { RequireAuth } from "./require-auth";

describe("RequireAuth", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, token: null, status: "idle" });
  });

  it("renders children when authenticated", () => {
    useAuthStore.setState({
      user: { id: "1", name: "admin", roles: ["admin"] },
      token: "t",
      status: "authenticated",
    });
    render(
      <RequireAuth>
        <p>dashboard</p>
      </RequireAuth>,
    );
    expect(screen.getByText("dashboard")).toBeInTheDocument();
  });

  it("redirects to /login when not authenticated", () => {
    useAuthStore.setState({ user: null, token: null, status: "unauthenticated" });
    render(
      <RequireAuth>
        <p>dashboard</p>
      </RequireAuth>,
    );
    expect(screen.queryByText("dashboard")).not.toBeInTheDocument();
    expect(screen.getByText("redirect:/login")).toBeInTheDocument();
  });
});
