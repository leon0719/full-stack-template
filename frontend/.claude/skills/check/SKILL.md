---
name: check
description: Run the full local quality gate for this template — Biome check, tsc type-check, and Vitest — and summarize results. Use when the user asks to "run checks", "check the code", "品質檢查", "跑測試", or before committing.
---

# Quality gate

依序執行，回報精簡 pass/fail。遇到第一個硬失敗就停下並貼出輸出。

```bash
bun run format        # Biome 格式化 + lint 修正 + 整理 import
bun run type-check    # tsc --noEmit -p tsconfig.app.json
bun run test          # Vitest run
```

## Report format
彙整成：`biome: OK · type-check: OK · test: N passed`。任何失敗則貼出相關行並提出修正。
