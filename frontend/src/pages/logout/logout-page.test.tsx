import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setAuthAdapter, useAuthStore } from "@/shared/auth";
import * as sharedLib from "@/shared/lib";
import { LogoutPage } from "./ui/logout-page";

describe("LogoutPage", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: "1", name: "u", roles: ["user"] },
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

  it("shows an error, not 'logged out', when the logout request fails (cookie may still be alive)", async () => {
    const reportErrorSpy = vi.spyOn(sharedLib, "reportError").mockImplementation(() => {});
    const error = new Error("POST /auth/logout failed with 500");
    setAuthAdapter({
      getLineLoginUrl: () => "",
      completeLineLogin: vi.fn(),
      logout: vi.fn().mockRejectedValue(error),
      me: vi.fn(),
    });

    render(<LogoutPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/登出失敗|logout failed/i);
    expect(screen.queryByText(/已登出|logged out/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /登入|login/i })).not.toBeInTheDocument();
    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(reportErrorSpy).toHaveBeenCalledWith(error, { source: "logout" });
  });

  it("retry runs logout again and confirms once it succeeds", async () => {
    vi.spyOn(sharedLib, "reportError").mockImplementation(() => {});
    const logout = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(undefined);
    setAuthAdapter({
      getLineLoginUrl: () => "",
      completeLineLogin: vi.fn(),
      logout,
      me: vi.fn(),
    });

    render(<LogoutPage />);

    await userEvent.click(await screen.findByRole("button", { name: /重試|retry/i }));

    expect(await screen.findByText(/已登出|logged out/i)).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });
});
