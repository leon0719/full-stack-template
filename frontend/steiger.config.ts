import fsd from "@feature-sliced/steiger-plugin";
import { defineConfig } from "steiger";

export default defineConfig([
  ...fsd.configs.recommended,
  {
    // 測試檔可以深層 import 內部 segment(測 internal helper 是合理需求)
    files: ["./src/**/*.test.{ts,tsx}"],
    rules: { "fsd/no-public-api-sidestep": "off" },
  },
  {
    // shared/auth、shared/i18n 刻意在 shared 內部 slice 化(見 CLAUDE.md「FSD 偏離說明」),
    // 其內部的 ui/model/lib 資料夾是 segment 而非誤用的保留字。
    files: ["./src/shared/**"],
    rules: { "fsd/no-reserved-folder-names": "off" },
  },
]);
