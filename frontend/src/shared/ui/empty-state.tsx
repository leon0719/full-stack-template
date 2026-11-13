import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** 列表/查詢沒有資料時的版面。action 放「新增第一筆」之類的出口 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  /** 預設「目前沒有資料」 */
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-foreground/15 px-4 py-12 text-center">
      <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-foreground/5 text-foreground/60">
        <Icon aria-hidden className="size-6" />
      </span>
      <p className="font-medium">{title ?? t("common.empty.title")}</p>
      {description && <p className="text-sm text-foreground/60">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
