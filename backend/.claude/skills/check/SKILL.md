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
make type-check               # mypy — loads .env.local or dummy SECRET_KEY/DATABASE_URL
SECRET_KEY=dummy DATABASE_URL="sqlite://:memory:" uv run pytest -q   # tests
```

## Notes

- `make type-check` already injects dummy env via the Makefile's `LOAD_LOCAL_ENV`, so it
  works without a real `.env.local`.
- Integration tests need a DB. Locally, the in-memory SQLite override above runs them
  without Postgres. To exercise the real stack instead, use `make test` (runs in Docker).
- If only quick feedback is wanted: `uv run pytest -m unit` (unit tests only).
- Ruff rule set and per-file ignores live in `pyproject.toml`; don't add blanket `# noqa`
  — prefer fixing, or a targeted per-file-ignore if it's a framework idiom.

## Report format

Summarize as: `ruff: OK · format: OK · mypy: OK · pytest: N passed`. For any failure,
show the relevant lines and propose the fix.
