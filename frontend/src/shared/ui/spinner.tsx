import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib";

/** 載入指示。預設念出「載入中…」;放在按鈕裡等已有文字的地方時傳 label="" 改為純裝飾 */
export function Spinner({ label, className }: { label?: string; className?: string }) {
  const { t } = useTranslation();
  const icon = (
    <Loader2
      aria-hidden
      className={cn("size-4 animate-spin motion-reduce:animate-none", className)}
    />
  );
  if (label === "") return icon;
  return (
    <span role="status" aria-label={label ?? t("common.loading")} className="inline-flex">
      {icon}
    </span>
  );
}
