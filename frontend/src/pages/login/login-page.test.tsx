// src/pages/login/login-page.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

import { fakeAuthAdapter, setAuthAdapter, useAuthStore } from "@/shared/auth";
import { LoginPage } from "./ui/login-page";

const makeStorage = (): Storage => {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
};

describe("LoginPage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
    navigate.mockReset();
    localStorage.clear();
    setAuthAdapter(fakeAuthAdapter);
    useAuthStore.setState({ user: null, token: null, status: "idle" });
  });

  it("logs in and navigates home on valid credentials", async () => {
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/帳號|username/i), "admin");
    await userEvent.type(screen.getByLabelText(/密碼|password/i), "admin");
    await userEvent.click(screen.getByRole("button", { name: /登入|login/i }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/" }));
    expect(useAuthStore.getState().status).toBe("authenticated");
  });

  it("shows an error on invalid credentials", async () => {
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/帳號|username/i), "admin");
    await userEvent.type(screen.getByLabelText(/密碼|password/i), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /登入|login/i }));
    await waitFor(() => expect(screen.getByText(/帳號或密碼錯誤/)).toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled();
  });
});
