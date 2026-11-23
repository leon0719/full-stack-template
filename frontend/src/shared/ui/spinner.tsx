import { Loader2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib";

/** 載入指示。預設念出「載入中…」;放在按鈕裡等已有文字的地方時傳 label="" 改為純裝飾 */
function Spinner({ className, label, ...props }: React.ComponentProps<"svg"> & { label?: string }) {
  const { t } = useTranslation();
  const decorative = label === "";
  return (
    <Loader2Icon
      data-slot="spinner"
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : (label ?? t("common.loading"))}
      aria-hidden={decorative || undefined}
      className={cn("size-4 animate-spin motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

export { Spinner };
