import { z } from "zod";

const schema = z.object({
  VITE_API_BASE_URL: z.url().or(z.literal("")).default(""),
});

const parsed = schema.parse({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL ?? "",
});

export const env = {
  apiBaseUrl: parsed.VITE_API_BASE_URL,
  mode: import.meta.env.MODE,
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
} as const;
