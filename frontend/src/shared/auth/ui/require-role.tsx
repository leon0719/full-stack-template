import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { usePermission } from "../lib/use-permission";
import type { Role } from "../model/types";

interface RequireRoleProps {
  role: Role;
  children: ReactNode;
  fallback?: ReactNode;
}

export function RequireRole({ role, children, fallback }: RequireRoleProps) {
  const { hasRole } = usePermission();
  const { t } = useTranslation();
  if (!hasRole(role)) {
    return (
      fallback ?? <div className="p-8 text-center text-destructive">{t("common.forbidden")}</div>
    );
  }
  return <>{children}</>;
}
