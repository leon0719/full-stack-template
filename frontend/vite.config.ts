/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
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
        advancedChunks: {
          groups: [{ name: "vendor", test: /[\\/]node_modules[\\/]/ }],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
