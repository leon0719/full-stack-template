import { useAuthStore } from "../model/auth-store";

export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  return { user, status, isAuthenticated: status === "authenticated", login, logout };
}
