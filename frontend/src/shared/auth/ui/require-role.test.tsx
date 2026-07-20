import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "../model/auth-store";
import { RequireRole } from "./require-role";

describe("RequireRole", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, token: null, status: "idle" });
  });

  it("renders children when the user has the role", () => {
    useAuthStore.setState({
      user: { id: "1", name: "admin", roles: ["admin"] },
      token: "t",
      status: "authenticated",
    });
    render(
      <RequireRole role="admin">
        <p>secret</p>
      </RequireRole>,
    );
    expect(screen.getByText("secret")).toBeInTheDocument();
  });

  it("renders a 403 fallback when the user lacks the role", () => {
    useAuthStore.setState({
      user: { id: "2", name: "user", roles: ["user"] },
      token: "t",
      status: "authenticated",
    });
    render(
      <RequireRole role="admin">
        <p>secret</p>
      </RequireRole>,
    );
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
    expect(screen.getByText(/403/)).toBeInTheDocument();
  });
});
