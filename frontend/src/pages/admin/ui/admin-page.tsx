import { useTranslation } from "react-i18next";
import { RequireRole } from "@/shared/auth";

export function AdminPage() {
  const { t } = useTranslation();
  return (
    <RequireRole role="admin">
      <div className="p-8">
        <h1 className="text-lg font-medium">{t("pages.admin.title")}</h1>
        <p className="text-foreground/60">{t("pages.admin.body")}</p>
      </div>
    </RequireRole>
  );
}
