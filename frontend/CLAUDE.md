# CLAUDE.md

Frontend half of the full-stack monorepo: Vite + React 19 + TS, FSD v2.1 pages-first, Biome as the single toolchain.
The backend is `../backend` (Django Ninja). Response language, human-only operations, Git rules, the
frontend–backend contract, and the integration layer (LINE login, dev cross-origin setup) are in
[../CLAUDE.md](../CLAUDE.md) and apply here.

## Commands

- `bun run dev` — dev server
- `bun run build` — bundle only; type-checking is `type-check`'s job
- `bun run format` — Biome format + fix + organize imports
- `bun run lint` — Biome lint (`lint:ci` = lint + format check, no writes)
- `bun run lint:fsd` — steiger FSD boundary check (exceptions in `steiger.config.ts`)
- `bun run type-check` — `tsc -b`
- `bun run test` / `bun run test:watch` — Vitest
- `make gen-api` (repo root) — export OpenAPI from `../backend` and generate `src/shared/api/schema.d.ts`;
  the backend need not be running. Run it whenever a backend schema/endpoint changes and commit the
  output; Biome skips it.

CI (repo root `.github/workflows/frontend-ci.yml`) runs lint:ci + lint:fsd + type-check + test + build;
pre-commit is managed by the repo root `.pre-commit-config.yaml` (lint + type-check on frontend changes).

## Architecture: FSD v2.1 (pages-first)

Layers, top to bottom: `app → pages → widgets → features → entities → shared`.
The template ships only `app / pages / shared`; extract `features / entities / widgets` when complexity demands it.

### Import rules (hard rules, enforced by steiger + Biome `noRestrictedImports`)
- Upper layers import lower layers, never the reverse.
- Slices on the same layer never import each other.
- Cross-slice imports go through the slice's `index.ts` (public API), never deep into a segment.
  Test files may deep-import (see `steiger.config.ts`).
- Always use the `@/` alias, never relative paths that climb layers.
- Segments: `ui` (components) / `model` (state, Zustand) / `api` (Query hooks + calls) / `lib` (pure functions) / `config`.

### When to extract to features / entities
- The same UI/logic is used by **two or more pages** → `features` or `widgets`.
- A business entity's types and API are shared across pages (user, product) → `entities/<name>`.
- Until then, keep the logic inside the page slice; do not split in advance.

New page → use the **scaffold-page** skill.

## Platform primitives (`src/shared`) — use these, don't reinvent

Before changing anything inside `shared/auth`, `shared/api`, `shared/i18n`, or the error-handling
primitives, read `docs/platform.md`.

- **Auth**: `useAuth()`, `usePermission()`, `<RequireAuth>`, `<RequireRole role>`. Frontend guards are UX
  only; the backend authorizes.
- **API**: `apiGet/apiPost/apiPut/apiPatch/apiDelete<T>` from `@/shared/api`. The client unwraps the
  `BaseResponse` envelope, so `T` is the inner type (`apiGet<Article>`, not `apiGet<BaseResponse<Article>>`).
  Branch on `ApiError.reason` (a stable code such as `"username_taken"`, usable as the i18n key
  `errors.<reason>`), never on `message`.
- **Types**: `import type { components } from "@/shared/api"` → `components["schemas"]["XxxResponse"]`;
  never hand-write backend types (example: `MeResponse` in `django-adapter.ts`).
- **i18n**: `const { t } = useTranslation()`; add keys to `locales/zh-TW.json` first (it is the type source).
  zod schema messages are i18n keys.
- **Errors**: `reportError(error, context?)`; `<ErrorBoundary>` already wraps the router.
- **Forms**: `useZodForm(schema)`.

## Frontend–backend conventions

- **Fixed-shape API types**: response / POST / PATCH types list every field; nullable is `| null`, never `?`
  (`?` is for query params only). Check with `=== null`. Hand-written contract interfaces get JSDoc on
  each field, matching the backend's field description.
- **Backend string enums are literal unions**: `type Status = "draft" | "published"`, values copied from
  the backend; no TS `enum`.
- **Time is a UTC contract**: always send an offset (`toISOString()` or `+08:00`); to display, `new Date(v)`
  then format — never `slice(0, 10)`. Date-only fields: start gets `00:00:00+08:00`, end gets
  `23:59:59.999999+08:00`.
- **Navigate with links**: plain navigation is `<Link>`, not `onClick` + `navigate`; use `navigate` only
  after validation, confirmation, or a successful API call.
- **Routes**: kebab-case plural nouns; IDs are route params (`/users/$userId`), not query strings.
- **Functions**: top-level functions use `function`; arrow functions only as arguments or object property values.

## Code Style

- Biome: indentWidth 2, lineWidth 100, double quotes, organizeImports.
- `noExplicitAny: warn` — avoid `any`.

## How to work

- **TDD**: failing test first (RED) → minimal implementation (GREEN) → refactor.
- Before you finish, run the **check** skill (Biome + steiger + tsc + Vitest). Report unverified items as
  unverified — never tick something you didn't run.
- Design and plan documents go in `docs/superpowers/` (gitignored, local only).
