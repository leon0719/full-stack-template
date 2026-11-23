import { type LucideIcon, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./empty";

/** 載入失敗的版面(以 shadcn Empty 組成)。典型用法:
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
    <Empty role="alert" className="border border-dashed border-destructive/30">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title ?? t("common.error.title")}</EmptyTitle>
        <EmptyDescription>{description || t("common.error.description")}</EmptyDescription>
      </EmptyHeader>
      {(onRetry || action) && (
        <EmptyContent className="flex-row justify-center">
          {onRetry && (
            <Button variant="outline" onClick={onRetry}>
              {t("common.error.retry")}
            </Button>
          )}
          {action}
        </EmptyContent>
      )}
    </Empty>
  );
}
