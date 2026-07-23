import { z } from "zod";

const schema = z.object({
  VITE_API_BASE_URL: z.url().or(z.literal("")).default(""),
  // 留空 = 停用錯誤追蹤。Sentry DSN 設計上就是可公開的寫入端點,
  // 放進 VITE_ 變數(會被打包進 bundle)是安全的。
  VITE_SENTRY_DSN: z.url().or(z.literal("")).default(""),
});

const parsed = schema.parse({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL ?? "",
  VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN ?? "",
});

export const env = {
  apiBaseUrl: parsed.VITE_API_BASE_URL,
  sentryDsn: parsed.VITE_SENTRY_DSN,
  mode: import.meta.env.MODE,
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
} as const;
