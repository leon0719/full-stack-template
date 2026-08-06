// src/pages/login-callback/ui/login-callback-page.tsx
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/shared/auth";

export function LoginCallbackPage() {
  const { completeLineLogin } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const search = useSearch({ strict: false }) as { code?: string };
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const code = search.code;
    if (!code) {
      setError(t("auth.login.callbackFailed"));
      return;
    }
    completeLineLogin(code)
      .then(() => navigate({ to: "/" }))
      .catch(() => setError(t("auth.login.callbackFailed")));
  }, [completeLineLogin, navigate, search.code, t]);

  return (
    <div className="mx-auto max-w-sm p-8 text-center">
      {error ? (
        <>
          <p className="text-destructive">{error}</p>
          <a href="/login" className="mt-4 inline-block underline">
            {t("auth.login.backToLogin")}
          </a>
        </>
      ) : (
        <p>{t("auth.login.callbackProcessing")}</p>
      )}
    </div>
  );
}
