---
name: check
description: Run the full local quality gate for this project — ruff format, ruff lint, mypy, and pytest — and summarize results. Use when the user asks to "run checks", "check the code", "品質檢查", "跑測試", "make sure it passes", or before committing/finishing a change.
---

# Quality gate

Run these in order and report a concise pass/fail summary. Stop and surface the first
hard failure with its output; otherwise run all four.

```bash
uv run ruff format .          # format
uv run ruff check --fix .     # lint (autofix)
make type-check               # mypy
make test-local               # pytest on in-memory SQLite
```

## Notes

- `make type-check` / `make test-local` inject dummy `SECRET_KEY`/`DATABASE_URL`
  via the Makefile's `LOAD_LOCAL_ENV` when `.env.local` is missing. Bare `uv run pytest` / `mypy`
  fail at settings import on a fresh clone — always go through `make`.
- To exercise the real stack (Postgres) instead, use `make test` (runs in Docker).
- Quick feedback on one file: `make test-local TEST=apps/<app>/tests.py`.
- Ruff rule set and per-file ignores live in `pyproject.toml`; don't add blanket `# noqa`
  — prefer fixing, or a targeted per-file-ignore if it's a framework idiom.

## Report format

Summarize as: `ruff: OK · format: OK · mypy: OK · pytest: N passed`. For any failure,
show the relevant lines and propose the fix. A step you didn't run is `⛔ not run: <reason>`,
never `OK`. A failing test is either outdated or a real regression — say which; never
decide on your own that a real regression is ignorable.
