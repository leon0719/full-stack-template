import { Link, useRouter } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";

/** 返回鍵:站內有上一頁就回上一頁(保留列表的篩選與捲動位置);
 *  直接從連結進來(例如通知信)沒有上一頁時,才走 to 指定的預設頁 */
function BackLink({ to }: { to: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Link
      to={to}
      aria-label={t("common.back")}
      onClick={(e) => {
        // Ctrl / Cmd / Shift / 中鍵是要開新分頁,交給瀏覽器照連結處理
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (!router.history.canGoBack()) return;
        e.preventDefault();
        router.history.back();
      }}
      className="inline-flex size-9 items-center justify-center rounded-md hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2"
    >
      <ChevronLeft aria-hidden className="size-5" />
    </Link>
  );
}

/** 頁面標題列:h1 + 說明 + 右側動作;同時設定分頁標題(`標題 · App`),離開頁面時還原 */
export function PageHeader({
  title,
  description,
  actions,
  backTo,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** 給了才顯示返回鍵;值是沒有上一頁時的預設目的地 */
  backTo?: string;
}) {
  const { t } = useTranslation();
  const appName = t("common.appName");
  useEffect(() => {
    document.title = `${title} · ${appName}`;
    return () => {
      document.title = appName;
    };
  }, [title, appName]);

  return (
    <header className="flex flex-wrap items-start gap-2 pb-6">
      {backTo && <BackLink to={backTo} />}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-bold">{title}</h1>
        {description && <p className="mt-1 text-sm text-foreground/60">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
