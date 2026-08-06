// src/pages/logout/ui/logout-page.tsx
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/shared/auth";

export function LogoutPage() {
  const { logout } = useAuth();
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    logout().finally(() => setDone(true));
  }, [logout]);

  return (
    <div className="mx-auto max-w-sm p-8 text-center">
      <h1 className="mb-4 text-lg font-medium">{t("auth.logout.title")}</h1>
      <p>{done ? t("auth.logout.done") : t("auth.logout.processing")}</p>
      {done && (
        <a href="/login" className="mt-4 inline-block underline">
          {t("auth.logout.backToLogin")}
        </a>
      )}
    </div>
  );
}
