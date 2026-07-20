import { Link, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/shared/auth";
import { LanguageSwitcher } from "@/shared/i18n";
import { Button } from "./button";

export function AppLayout() {
  const { user, isAuthenticated, logout } = useAuth();
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
              <Button size="sm" variant="outline" onClick={() => logout()}>
                {t("common.logout")}
              </Button>
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
