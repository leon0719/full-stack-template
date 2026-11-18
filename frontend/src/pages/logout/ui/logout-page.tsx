// src/pages/logout/ui/logout-page.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/shared/auth";
import { reportError } from "@/shared/lib";
import { ErrorState } from "@/shared/ui";

type LogoutState = "pending" | "done" | "failed";

export function LogoutPage() {
  const { logout } = useAuth();
  const { t } = useTranslation();
  const [state, setState] = useState<LogoutState>("pending");
  const ran = useRef(false);

  const run = useCallback(() => {
    setState("pending");
    logout()
      .then(() => setState("done"))
      .catch((err: unknown) => {
        // 後端沒確認登出(網路、5xx、CSRF):cookie 可能還活著,store 也維持已登入,
        // 所以不能顯示「已登出」,否則使用者按回登入頁後會被 me() 悄悄登回去
        reportError(err, { source: "logout" });
        setState("failed");
      });
  }, [logout]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    run();
  }, [run]);

  if (state === "failed") {
    return (
      <div className="mx-auto max-w-sm p-8">
        <ErrorState
          title={t("auth.logout.failedTitle")}
          description={t("auth.logout.failed")}
          onRetry={run}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm p-8 text-center">
      <h1 className="mb-4 text-lg font-medium">{t("auth.logout.title")}</h1>
      <p>{state === "done" ? t("auth.logout.done") : t("auth.logout.processing")}</p>
      {state === "done" && (
        <a href="/login" className="mt-4 inline-block underline">
          {t("auth.logout.backToLogin")}
        </a>
      )}
    </div>
  );
}
