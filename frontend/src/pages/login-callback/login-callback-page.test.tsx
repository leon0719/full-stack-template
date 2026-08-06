import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
const searchParams = { code: "code-abc" };
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useSearch: () => searchParams,
}));

import { setAuthAdapter, useAuthStore } from "@/shared/auth";
import { LoginCallbackPage } from "./ui/login-callback-page";

describe("LoginCallbackPage", () => {
  beforeEach(() => {
    navigate.mockReset();
    useAuthStore.setState({ user: null, token: null, status: "idle" });
  });

  it("completes the LINE login and navigates home on success", async () => {
    setAuthAdapter({
      getLineLoginUrl: () => "",
      completeLineLogin: vi.fn().mockResolvedValue({
        user: { id: "1", name: "u", roles: ["user"] },
        token: "tok",
      }),
      logout: vi.fn(),
      me: vi.fn(),
    });

    render(<LoginCallbackPage />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/" }));
    expect(useAuthStore.getState().status).toBe("authenticated");
  });

  it("shows an error message when the exchange fails", async () => {
    setAuthAdapter({
      getLineLoginUrl: () => "",
      completeLineLogin: vi.fn().mockRejectedValue(new Error("Invalid or expired code")),
      logout: vi.fn(),
      me: vi.fn(),
    });

    render(<LoginCallbackPage />);

    expect(await screen.findByText(/登入失敗|failed/i)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
