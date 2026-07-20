import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "@/shared/auth";
import { AdminPage } from "./ui/admin-page";

describe("AdminPage", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, token: null, status: "idle" });
  });

  it("shows admin content for an admin user", () => {
    useAuthStore.setState({
      user: { id: "1", name: "admin", roles: ["admin"] },
      token: "t",
      status: "authenticated",
    });
    render(<AdminPage />);
    expect(screen.getByText(/admin area/i)).toBeInTheDocument();
  });

  it("shows 403 for a non-admin user", () => {
    useAuthStore.setState({
      user: { id: "2", name: "user", roles: ["user"] },
      token: "t",
      status: "authenticated",
    });
    render(<AdminPage />);
    expect(screen.queryByText(/admin area/i)).not.toBeInTheDocument();
    expect(screen.getByText(/403/)).toBeInTheDocument();
  });
});
