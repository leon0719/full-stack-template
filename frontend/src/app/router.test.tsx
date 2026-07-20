import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthForTests, useAuthStore } from "@/shared/auth/model/auth-store";
import { createAppRouter, router } from "./router";

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

const renderAt = (path: string) => {
  const testRouter = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const utils = render(<RouterProvider router={testRouter} />);
  return { testRouter, ...utils };
};

describe("router", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
    resetAuthForTests();
    useAuthStore.setState({ user: null, token: null, status: "idle" });
  });

  it("registers the login and admin routes", () => {
    const paths = Object.values(router.routesById).map((r) => r.fullPath);
    expect(paths).toContain("/login");
    expect(paths).toContain("/admin");
  });

  it("redirects an unauthenticated visitor from /admin to /login", async () => {
    const { testRouter } = renderAt("/admin");
    await waitFor(() => {
      expect(testRouter.state.location.pathname).toBe("/login");
    });
  });

  it("renders a 404 page for unknown paths", async () => {
    const { findByText } = renderAt("/does-not-exist");
    expect(await findByText(/404/)).toBeInTheDocument();
  });

  it("redirects an authenticated visitor away from /login", async () => {
    localStorage.setItem("auth.token", "fake-token-user");
    const { testRouter } = renderAt("/login");
    await waitFor(() => {
      expect(testRouter.state.location.pathname).toBe("/");
    });
  });

  it("lets a cold-loaded session reach /admin once restored from storage", async () => {
    // 模擬硬重新整理:localStorage 有 token,但 store 尚未 init
    localStorage.setItem("auth.token", "fake-token-admin");
    const { testRouter } = renderAt("/admin");
    await waitFor(() => {
      expect(testRouter.state.location.pathname).toBe("/admin");
    });
    expect(useAuthStore.getState().status).toBe("authenticated");
  });
});
