import { type LucideIcon, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";

/** 載入失敗的版面(樣式同 EmptyState)。典型用法:
 *  `if (query.isError) return <ErrorState onRetry={() => query.refetch()} />` */
export function ErrorState({
  icon: Icon = TriangleAlert,
  title,
  description,
  onRetry,
  action,
}: {
  icon?: LucideIcon;
  /** 預設「發生錯誤」 */
  title?: string;
  /** 給人看的原因;沒有(或空字串)就用通用文案。不要直接塞 ApiError.message,改用 reason 對 i18n key */
  description?: string;
  onRetry?: () => void;
  /** 重試以外的出口,例如回首頁的連結 */
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-destructive/30 px-4 py-12 text-center"
    >
      <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <Icon aria-hidden className="size-6" />
      </span>
      <p className="font-medium">{title ?? t("common.error.title")}</p>
      <p className="text-sm text-foreground/60">{description || t("common.error.description")}</p>
      {(onRetry || action) && (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {onRetry && (
            <Button variant="outline" onClick={onRetry}>
              {t("common.error.retry")}
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
