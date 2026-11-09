---
name: check
description: Run the full local quality gate for this template — Biome check, steiger FSD check, tsc type-check, and Vitest — and summarize results. Use when the user asks to "run checks", "check the code", "品質檢查", "跑測試", or before committing.
---

# Quality gate

與 CI（repo 根目錄 `.github/workflows/frontend-ci.yml`）同一組檢查，依序執行，回報精簡 pass/fail。
遇到第一個硬失敗就停下並貼出輸出。

```bash
bun run lint:ci       # Biome lint + format 全檢（不改檔）
bun run lint:fsd      # steiger:FSD 分層與 public API
bun run type-check    # tsc -b（app + node 兩個 project）
bun run test          # Vitest run
```

`lint:ci` 若只有格式/import 排序問題，先跑 `bun run format` 自動修正再重跑。

## Report format
彙整成：`biome: OK · fsd: OK · type-check: OK · test: N passed`。任何失敗則貼出相關行並提出修正。
