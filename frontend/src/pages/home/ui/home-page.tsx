import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui";

export function HomePage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">{t("pages.home.title")}</h1>
      <p className="mt-2 text-foreground/70">{t("pages.home.subtitle")}</p>
      <div className="mt-6 flex gap-3">
        <Link to="/demo">
          <Button>{t("pages.home.toDemo")}</Button>
        </Link>
      </div>
    </main>
  );
}
