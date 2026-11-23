import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui";

export function HomePage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        {t("pages.home.title")}
      </h1>
      <p className="mt-3 max-w-prose text-muted-foreground">{t("pages.home.subtitle")}</p>
      <div className="mt-8 flex gap-3">
        <Button asChild size="lg">
          <Link to="/demo">{t("pages.home.toDemo")}</Link>
        </Button>
      </div>
    </div>
  );
}
