import { CircleHelp, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib";
import { Button } from "./button";

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
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  // 沒有掛 host(例如單獨 render 某個頁面的測試)時退回瀏覽器原生確認框,流程不會卡住
  if (!show) return Promise.resolve(window.confirm(options.message));
  const open = show;
  return new Promise((resolve) => open({ ...options, resolve }));
}

/**
 * 用原生 `<dialog>` + showModal():瀏覽器負責 focus trap(頁面其他部分變 inert)、
 * Esc 關閉(cancel 事件)與 top layer;關閉後焦點回到開啟前的元素。
 */
export function ConfirmDialogHost() {
  const { t } = useTranslation();
  const [request, setRequest] = useState<Request | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    // 前一個還開著又來一個:先把前一個當作取消,不然它的 Promise 永遠不會結束
    show = (next) =>
      setRequest((current) => {
        current?.resolve(false);
        return next;
      });
    return () => {
      show = null;
    };
  }, []);

  useEffect(() => {
    if (!request) return;
    const opener = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // 明確指定初始焦點(各瀏覽器對 dialog 內 autofocus 的行為不一致)
    dialog?.querySelector<HTMLButtonElement>("[data-initial-focus]")?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus();
    };
  }, [request]);

  if (!request) return null;
  const { title, message, confirmLabel, cancelLabel, danger, resolve } = request;
  const finish = (ok: boolean) => {
    resolve(ok);
    setRequest(null);
  };
  const Icon = danger ? TriangleAlert : CircleHelp;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 鍵盤的 Esc 由 dialog 的 cancel 事件處理,這裡只處理點背景
    <dialog
      ref={ref}
      aria-labelledby={title ? titleId : messageId}
      aria-describedby={title ? messageId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        finish(false);
      }}
      onClick={(e) => {
        // 點到 dialog 本身(::backdrop 區域)才算點背景
        if (e.target === e.currentTarget) finish(false);
      }}
      className="m-auto w-[min(calc(100vw-2rem),28rem)] rounded-lg bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-5 p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full",
              danger ? "bg-destructive/10 text-destructive" : "bg-foreground/5 text-foreground/70",
            )}
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1 pt-1">
            {title && (
              <h2 id={titleId} className="mb-1 font-semibold">
                {title}
              </h2>
            )}
            <p
              id={messageId}
              className="max-h-[50vh] overflow-y-auto text-sm leading-relaxed whitespace-pre-line"
            >
              {message}
            </p>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            data-initial-focus={danger ? "" : undefined}
            onClick={() => finish(false)}
          >
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button
            variant={danger ? "destructive" : "default"}
            data-initial-focus={danger ? undefined : ""}
            onClick={() => finish(true)}
          >
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
