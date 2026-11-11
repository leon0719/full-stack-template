---
name: check
description: Run the full local quality gate for this template — Biome check, steiger FSD check, tsc type-check, and Vitest — and summarize results. Use when the user asks to "run checks", "check the code", "品質檢查", "跑測試", or before committing.
---

# Quality gate

The same checks CI runs (repo root `.github/workflows/frontend-ci.yml`). Run them in order and report a concise pass/fail.
Stop at the first hard failure and paste its output.

```bash
bun run lint:ci       # Biome lint + format check (no writes)
bun run lint:fsd      # steiger: FSD layering and public API
bun run type-check    # tsc -b (app + node projects)
bun run test          # Vitest run
```

If `lint:ci` fails only on formatting / import order, run `bun run format` to auto-fix, then re-run.

## Report format
Summarize as: `biome: OK · fsd: OK · type-check: OK · test: N passed`. For any failure, paste the
relevant lines and propose a fix. A step that was not run is reported as not run, never `OK`.
