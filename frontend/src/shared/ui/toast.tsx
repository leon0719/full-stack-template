import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib";

export type ToastTone = "success" | "error" | "info";

export interface ToastOptions {
  tone?: ToastTone;
  /** 毫秒;0 = 不自動消失。預設 4 秒,錯誤 6 秒(要留時間讀) */
  duration?: number;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  duration: number;
}

const MAX_VISIBLE = 3;
let nextId = 1;
// 由掛載中的 <Toaster /> 註冊;整個 App 只掛一個(app/entrypoint.tsx)
let push: ((item: ToastItem) => void) | null = null;

function show(message: string, options: ToastOptions = {}): number {
  const tone = options.tone ?? "info";
  const item = {
    id: nextId++,
    message,
    tone,
    duration: options.duration ?? (tone === "error" ? 6000 : 4000),
  };
  // 沒有掛 Toaster(例如單獨 render 某個頁面的測試)就什麼都不做,不影響流程
  push?.(item);
  return item.id;
}

/**
 * 動作結果的短暫回饋。不是 hook,mutation 的 onSuccess / onError 等 React 外部也能呼叫:
 * `toast.success(t("x.saved"))`、`toast.error(t(\`errors.${error.reason}\`))`。
 * 需要使用者決定的事用 confirmDialog,不要用 toast。
 */
export const toast = Object.assign(show, {
  success: (message: string, options?: Omit<ToastOptions, "tone">) =>
    show(message, { ...options, tone: "success" }),
  error: (message: string, options?: Omit<ToastOptions, "tone">) =>
    show(message, { ...options, tone: "error" }),
  info: (message: string, options?: Omit<ToastOptions, "tone">) =>
    show(message, { ...options, tone: "info" }),
});

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info } as const;

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const { t } = useTranslation();
  // onDismiss 每次 render 都是新函式;放 ref,其他 toast 進出時才不會重設這則的計時
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });
  useEffect(() => {
    if (item.duration <= 0) return;
    const timer = setTimeout(() => dismissRef.current(), item.duration);
    return () => clearTimeout(timer);
  }, [item.duration]);
  const Icon = ICONS[item.tone];
  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full items-start gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-lg",
        item.tone === "success" && "border-success/30",
        item.tone === "error" && "border-destructive/40",
        item.tone === "info" && "border-foreground/15",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          item.tone === "success" && "text-success",
          item.tone === "error" && "text-destructive",
          item.tone === "info" && "text-info",
        )}
      />
      <p className="flex-1 break-words">{item.message}</p>
      <button
        type="button"
        aria-label={t("common.toast.dismiss")}
        onClick={onDismiss}
        className="rounded p-0.5 opacity-60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}

export function Toaster() {
  const { t } = useTranslation();
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    // 超過上限時丟掉最舊的,畫面不會被一波錯誤塞滿
    push = (item) => setItems((current) => [...current, item].slice(-MAX_VISIBLE));
    return () => {
      push = null;
    };
  }, []);

  const dismiss = (id: number) => setItems((current) => current.filter((i) => i.id !== id));

  return (
    // live region 要先存在於畫面上、之後才放進文字,螢幕閱讀器才會念出來
    <section
      aria-label={t("common.toast.region")}
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:inset-x-auto sm:right-4"
    >
      <div role="status" aria-live="polite" className="flex w-full max-w-sm flex-col gap-2">
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </section>
  );
}
