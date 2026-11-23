import { Link, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/shared/auth";
import { LanguageSwitcher } from "@/shared/i18n";
import { buttonVariants } from "./button";

export function AppLayout() {
  const { user, isAuthenticated } = useAuth();
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex flex-col">
      {/* 品牌色帶:整個 App 唯一大面積用主色的地方,其餘畫面維持中性 */}
      <header className="flex h-14 items-center justify-between bg-primary px-4 text-primary-foreground sm:px-6">
        <Link
          to="/"
          className="flex items-center gap-2.5 rounded-sm font-semibold tracking-tight focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
        >
          {/* 品牌標誌的佔位:換成專案 logo */}
          <span aria-hidden className="size-3.5 rounded-[3px] bg-ring" />
          {t("common.appName")}
        </Link>
        <div className="flex items-center gap-3">
          <LanguageSwitcher className="border-primary-foreground/25 bg-transparent text-primary-foreground [&>option]:text-foreground" />
          {isAuthenticated && (
            <>
              <span className="text-sm text-primary-foreground/75">{user?.name}</span>
              <Link to="/logout" className={buttonVariants({ variant: "secondary", size: "sm" })}>
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
