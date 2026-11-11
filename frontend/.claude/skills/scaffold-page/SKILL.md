---
name: scaffold-page
description: Scaffold a new FSD page slice (pages/<name>) with ui + api segments, public index.ts, a route registration, and a test. Use when the user asks to "add a page", "new page", "新增頁面", "scaffold a page".
---

# Scaffold a page slice

Add a page following the FSD pages-first convention. Confirm `<name>` (kebab-case) with the user, then:

1. Create `src/pages/<name>/ui/<name>-page.tsx`:

```tsx
export function <Pascal>Page() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold"><Pascal></h1>
    </main>
  );
}
```

2. If it fetches data, create `src/pages/<name>/api/use-<name>.ts` (a TanStack Query hook calling
   `apiGet` from `@/shared/api`).

3. Create `src/pages/<name>/index.ts`, re-exporting only what outsiders need:

```ts
export { <Pascal>Page } from "./ui/<name>-page";
```

4. Register it in `src/app/router.tsx` (use `lazyRouteComponent` to keep code splitting; **never**
   import the page statically):

```tsx
const <camel>Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/<name>",
  component: lazyRouteComponent(() => import("@/pages/<name>"), "<Pascal>Page"),
});
// and add <camel>Route to rootRoute.addChildren([...])
```

5. Add the test `src/pages/<name>/<name>-page.test.tsx`; at minimum assert the heading renders.

## Hard rules
- Imports go to lower layers only; cross-slice goes through `index.ts`; always use the `@/` alias.
- Finish by running the `check` skill.
