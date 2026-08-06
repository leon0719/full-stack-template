import { Link, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/shared/auth";
import { LanguageSwitcher } from "@/shared/i18n";

export function AppLayout() {
  const { user, isAuthenticated } = useAuth();
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between border-b border-foreground/10 px-4 h-14">
        <Link to="/" className="font-medium">
          {t("common.appName")}
        </Link>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          {isAuthenticated && (
            <>
              <span className="text-sm text-foreground/70">{user?.name}</span>
              <Link
                to="/logout"
                className="inline-flex h-8 items-center justify-center rounded-md border border-foreground/20 bg-background px-3 text-xs font-medium transition-colors hover:bg-foreground/5"
              >
                {t("common.logout")}
              </Link>
            </>
          )}
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
