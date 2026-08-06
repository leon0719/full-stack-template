import { getLineLoginUrl, useAuthStore } from "../model/auth-store";

export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const completeLineLogin = useAuthStore((s) => s.completeLineLogin);
  const logout = useAuthStore((s) => s.logout);
  return {
    user,
    status,
    isAuthenticated: status === "authenticated",
    getLineLoginUrl,
    completeLineLogin,
    logout,
  };
}
