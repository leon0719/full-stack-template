export type ErrorReporter = (error: unknown, context?: Record<string, unknown>) => void;

const defaultReporter: ErrorReporter = (error, context) => {
  console.error("[app-error]", error, context);
};

let reporter: ErrorReporter = defaultReporter;

// 接上 Sentry 等服務時,在 app 啟動處呼叫一次即可,其餘程式碼不動。
export function setErrorReporter(next: ErrorReporter): void {
  reporter = next;
}

export function resetErrorReporterForTests(): void {
  reporter = defaultReporter;
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  reporter(error, context);
}

// ErrorBoundary 抓不到事件處理器與非同步錯誤,需靠 window 層級監聽補齊。
export function installGlobalErrorReporting(target: Window = window): void {
  target.addEventListener("error", (event) => {
    reportError(event.error ?? event.message, { source: "window.error" });
  });
  target.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason, { source: "unhandledrejection" });
  });
}
