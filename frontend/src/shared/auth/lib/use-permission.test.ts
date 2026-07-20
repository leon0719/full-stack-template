import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "../model/auth-store";
import { usePermission } from "./use-permission";

describe("usePermission", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, token: null, status: "idle" });
  });

  it("returns false for any role when logged out", () => {
    const { result } = renderHook(() => usePermission());
    expect(result.current.hasRole("admin")).toBe(false);
    expect(result.current.hasAnyRole(["admin", "user"])).toBe(false);
  });

  it("reflects the current user's roles", () => {
    useAuthStore.setState({
      user: { id: "1", name: "admin", roles: ["admin", "user"] },
      token: "t",
      status: "authenticated",
    });
    const { result } = renderHook(() => usePermission());
    expect(result.current.hasRole("admin")).toBe(true);
    expect(result.current.hasRole("user")).toBe(true);
    expect(result.current.hasAnyRole(["admin"])).toBe(true);
  });

  it("returns false for a role the user lacks", () => {
    useAuthStore.setState({
      user: { id: "2", name: "user", roles: ["user"] },
      token: "t",
      status: "authenticated",
    });
    const { result } = renderHook(() => usePermission());
    expect(result.current.hasRole("admin")).toBe(false);
    expect(result.current.hasAnyRole(["admin"])).toBe(false);
  });
});
