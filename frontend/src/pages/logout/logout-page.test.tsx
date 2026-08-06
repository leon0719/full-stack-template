import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setAuthAdapter, useAuthStore } from "@/shared/auth";
import { LogoutPage } from "./ui/logout-page";

describe("LogoutPage", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: "1", name: "u", roles: ["user"] },
      token: "tok",
      status: "authenticated",
    });
  });

  it("logs the user out and shows a confirmation", async () => {
    setAuthAdapter({
      getLineLoginUrl: () => "",
      completeLineLogin: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      me: vi.fn(),
    });

    render(<LogoutPage />);

    await waitFor(() => expect(useAuthStore.getState().status).toBe("unauthenticated"));
    expect(await screen.findByText(/已登出|logged out/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /登入|login/i })).toHaveAttribute("href", "/login");
  });
});
