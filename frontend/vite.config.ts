/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * build 時把 CSP 以 <meta> 寫進 index.html,任何靜態主機(S3/CloudFront、nginx)都有效。
 * 只在 build 套用:dev server 的 HMR 會注入 inline script,嚴格 CSP 會擋掉它。
 * meta CSP 不支援 frame-ancestors / report-uri,防 clickjacking 要靠主機送的
 * X-Frame-Options header(部署文件有寫)。
 */
function cspMeta(env: Record<string, string>): Plugin {
  // API 與 Sentry 的 origin 從 build 時的 env 算出來;DSN 的 URL origin 不含 key(userinfo)
  const origins = [env.VITE_API_BASE_URL, env.VITE_SENTRY_DSN]
    .filter(Boolean)
    .map((url) => new URL(url).origin);
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // api.github.com 只給 /demo 頁用,刪 demo 時一併拿掉
    `connect-src 'self' https://api.github.com ${origins.join(" ")}`.trim(),
    // read-excel-file 用 blob URL 起 Web Worker 解壓縮
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  return {
    name: "csp-meta",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: policy },
        injectTo: "head-prepend",
      },
    ],
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    cspMeta(loadEnv(mode, process.cwd(), "VITE_")),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    // 產 sourcemap 供錯誤追蹤服務使用,但不在瀏覽器 devtools 對外曝光
    sourcemap: "hidden",
    // 預設 500KB 的警告門檻是針對「單一大 chunk」的經驗值。vendor 拆出來之後
    // 它必然超標(React + Router + Query + i18n + Sentry),每次 build 都跳警告
    // 只會讓人學會忽略 build 輸出。門檻提高到 vendor 現況之上,真正的異常成長
    // (例如誤把大型套件加進來)仍然會被擋下來。
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // 把第三方套件從應用程式碼拆開。動機是 Sentry SDK 進 bundle 後主 chunk
        // 從 416KB 漲到 553KB —— 但真正的問題不是大小,是「改一行業務程式碼就
        // 讓使用者重新下載整包 vendor」。拆開後 vendor chunk 的 hash 只在依賴
        // 真的變動時才改變,快取命中率高得多。
        codeSplitting: {
          groups: [
            // 只在動態 import 時才需要的大型套件要自成一組(priority 較高先比對),
            // 否則會被併進 vendor、首頁就整包下載,lazy import 等於白做。
            // read-excel-file 與它的依賴:shared/lib/file/spreadsheet.ts 讀 xlsx 時才載入。
            {
              name: "spreadsheet",
              test: /[\\/]node_modules[\\/](read-excel-file|fflate|saxen|unzipper-esm|worker-f)[\\/]/,
              priority: 10,
            },
            { name: "vendor", test: /[\\/]node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
}));
