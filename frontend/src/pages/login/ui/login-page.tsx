// src/pages/login/ui/login-page.tsx
import { useTranslation } from "react-i18next";
import { useAuth } from "@/shared/auth";

export function LoginPage() {
  const { getLineLoginUrl } = useAuth();
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-sm p-8 text-center">
      <h1 className="mb-6 text-lg font-medium">{t("auth.login.title")}</h1>
      <a
        href={getLineLoginUrl()}
        className="inline-flex w-full items-center justify-center rounded-md bg-[#06C755] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        {t("auth.login.lineButton")}
      </a>
    </div>
  );
}
