import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, confirmDialog, EmptyState, ErrorState, Spinner, toast } from "@/shared/ui";

// confirmDialog() / toast() 的掛載點(ConfirmDialogHost / Toaster)在 app/entrypoint.tsx,頁面直接呼叫即可

export function UiKitSection() {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState<string | null>(null);
  const [retries, setRetries] = useState(0);

  const ask = async (danger: boolean) => {
    const ok = await confirmDialog(
      danger
        ? {
            message: t("pages.demo.kit.dangerMessage"),
            confirmLabel: t("pages.demo.kit.dangerLabel"),
            danger: true,
          }
        : { message: t("pages.demo.kit.confirmMessage") },
    );
    setAnswer(ok ? t("pages.demo.kit.confirmed") : t("pages.demo.kit.cancelled"));
  };

  return (
    <section className="mt-10 flex flex-col gap-6">
      <h2 className="text-xl font-bold">{t("pages.demo.kit.title")}</h2>

      <div className="flex flex-wrap items-center gap-2">
        <Badge>{t("common.job.status.pending")}</Badge>
        <Badge tone="info">{t("common.job.status.running")}</Badge>
        <Badge tone="success">{t("common.job.status.succeeded")}</Badge>
        <Badge tone="warning">{t("common.job.status.cancelled")}</Badge>
        <Badge tone="danger">{t("common.job.status.failed")}</Badge>
        <Spinner />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => ask(false)}>
          {t("pages.demo.kit.openConfirm")}
        </Button>
        <Button variant="destructive" onClick={() => ask(true)}>
          {t("pages.demo.kit.openDanger")}
        </Button>
        {answer && <span className="text-sm text-foreground/70">{answer}</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => toast.success(t("pages.demo.kit.saved"))}>
          {t("pages.demo.kit.toastSuccess")}
        </Button>
        <Button variant="outline" onClick={() => toast.error(t("pages.demo.kit.saveFailed"))}>
          {t("pages.demo.kit.toastError")}
        </Button>
        <Button variant="outline" onClick={() => toast(t("pages.demo.kit.info"))}>
          {t("pages.demo.kit.toastInfo")}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <EmptyState
          description={t("pages.demo.kit.emptyDescription")}
          action={<Button size="sm">{t("pages.demo.kit.create")}</Button>}
        />
        <ErrorState
          description={
            retries > 0
              ? t("pages.demo.kit.retried", { count: retries })
              : t("pages.demo.kit.errorDescription")
          }
          onRetry={() => setRetries((n) => n + 1)}
        />
      </div>
    </section>
  );
}
