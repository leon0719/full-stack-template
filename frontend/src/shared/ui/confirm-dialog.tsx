import { CircleHelp, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "./alert-dialog";

export interface ConfirmOptions {
  title?: string;
  /** 可用 \n 換行;太長時只捲動訊息區,按鈕始終留在畫面內 */
  message: string;
  /** 確認鈕文字:寫按下去會發生的事(「刪除」「送出」),預設「確定」 */
  confirmLabel?: string;
  cancelLabel?: string;
  /** 刪除這類不好回復的動作:確認鈕用警示色,且預設焦點落在「取消」 */
  danger?: boolean;
}

type Request = ConfirmOptions & { resolve: (ok: boolean) => void };

// 由掛載中的 <ConfirmDialogHost /> 註冊;整個 App 只掛一個(app/entrypoint.tsx)
let show: ((request: Request) => void) | null = null;

/**
 * 可 await 的確認框,取代 window.confirm:
 * `if (!(await confirmDialog({ message: t("x.confirmDelete"), danger: true }))) return;`
 * 不是 hook,mutation callback、事件處理器裡都能直接呼叫。
 * 需要自訂內容(表單、清單)時直接用 <AlertDialog> 元件組。
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  // 沒有掛 host(例如單獨 render 某個頁面的測試)時退回瀏覽器原生確認框,流程不會卡住
  if (!show) return Promise.resolve(window.confirm(options.message));
  const open = show;
  return new Promise((resolve) => open({ ...options, resolve }));
}

/**
 * 以 shadcn AlertDialog(Radix)實作:focus trap、Esc 取消、關閉後焦點回到開啟前的元素。
 * AlertDialog 依規範點背景不會關閉,一定要按按鈕或 Esc。
 */
export function ConfirmDialogHost() {
  const { t } = useTranslation();
  // request 在關閉後保留,讓關閉動畫期間內容不會先消失;open 才是開關
  const [request, setRequest] = useState<Request | null>(null);
  const [open, setOpen] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    show = (next) => {
      // 已經開著時焦點在對話框裡,不覆寫:關閉後要回到最初開啟它的元素
      openerRef.current ??= document.activeElement as HTMLElement | null;
      // 前一個還開著又來一個:先把前一個當作取消,不然它的 Promise 永遠不會結束
      setRequest((current) => {
        current?.resolve(false);
        return next;
      });
      setOpen(true);
    };
    return () => {
      show = null;
    };
  }, []);

  const finish = (ok: boolean) => {
    request?.resolve(ok);
    setOpen(false);
  };

  const danger = request?.danger ?? false;
  const Icon = danger ? TriangleAlert : CircleHelp;

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && finish(false)}>
      {request && (
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            // Radix 預設把焦點還給 Trigger;這裡沒有 Trigger,改還給開啟前的元素
            e.preventDefault();
            openerRef.current?.focus();
            openerRef.current = null;
          }}
          onOpenAutoFocus={(e) => {
            // Radix 預設聚焦「取消」;一般確認改聚焦確認鈕,危險動作維持在取消
            if (danger) return;
            e.preventDefault();
            confirmRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogMedia
              className={cn(danger && "bg-destructive/10 text-destructive dark:bg-destructive/20")}
            >
              <Icon />
            </AlertDialogMedia>
            {request.title ? (
              <>
                <AlertDialogTitle>{request.title}</AlertDialogTitle>
                <AlertDialogDescription className="max-h-[50vh] overflow-y-auto whitespace-pre-line">
                  {request.message}
                </AlertDialogDescription>
              </>
            ) : (
              // 沒有標題時訊息本身就是對話框的名稱
              <AlertDialogTitle className="max-h-[50vh] overflow-y-auto text-sm font-normal whitespace-pre-line">
                {request.message}
              </AlertDialogTitle>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{request.cancelLabel ?? t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              ref={confirmRef}
              variant={danger ? "destructive" : "default"}
              onClick={(e) => {
                // 自己關:不讓 Radix 再觸發 onOpenChange(false) 被當成取消
                e.preventDefault();
                finish(true);
              }}
            >
              {request.confirmLabel ?? t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
