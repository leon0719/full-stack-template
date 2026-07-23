import * as Sentry from "@sentry/react";
import { env } from "@/shared/config";
import { setErrorReporter } from "./report-error";

/**
 * 把 reportError 接到 Sentry。未設定 VITE_SENTRY_DSN 時完全不啟用。
 *
 * 在此之前,report-error.ts 的 reporter 預設只是 console.error —— 抽象層留好了,
 * 但沒有任何呼叫端接上去,所以前端錯誤實際上哪裡都沒送。這支就是那個呼叫端。
 *
 * 注意 VITE_ 變數會被打包進 bundle、對使用者公開。Sentry 的 DSN 本來就設計成
 * 可公開(它只能寫入、不能讀取專案資料),所以放在這裡是安全的 —— 但別把其他
 * Sentry 的 token(例如 auth token)放進 VITE_ 變數。
 */
export function initErrorTracking(): void {
  if (!env.sentryDsn) return;

  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.mode,
    // 只在 prod build 開啟效能追蹤,dev 不需要而且會吵。
    tracesSampleRate: env.isProd ? 0.1 : 0,
    // 預設會把使用者 IP 等 PII 一起送出;明確關掉,需要時再依隱私政策開啟。
    sendDefaultPii: false,
  });

  setErrorReporter((error, context) => {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  });
}
