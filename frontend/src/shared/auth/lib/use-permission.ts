import { useAuthStore } from "../model/auth-store";
import type { Role } from "../model/types";

export function usePermission() {
  const user = useAuthStore((s) => s.user);
  const roles = user?.roles ?? [];
  return {
    hasRole: (role: Role): boolean => roles.includes(role),
    hasAnyRole: (candidates: Role[]): boolean => candidates.some((r) => roles.includes(r)),
  };
}
