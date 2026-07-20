---
name: scaffold-page
description: Scaffold a new FSD page slice (pages/<name>) with ui + api segments, public index.ts, a route registration, and a test. Use when the user asks to "add a page", "new page", "新增頁面", "scaffold a page".
---

# Scaffold a page slice

依 FSD pages-first 慣例新增一個 page。向使用者確認 `<name>`（kebab-case）後：

1. 建 `src/pages/<name>/ui/<name>-page.tsx`：

```tsx
export function <Pascal>Page() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold"><Pascal></h1>
    </main>
  );
}
```

2. 若需資料抓取，建 `src/pages/<name>/api/use-<name>.ts`（TanStack Query hook，
   透過 `@/shared/api` 的 `apiGet` 呼叫）。

3. 建 `src/pages/<name>/index.ts`：

```ts
export { <Pascal>Page } from "./ui/<name>-page";
```

4. 在 `src/app/router.tsx` 註冊：

```tsx
import { <Pascal>Page } from "@/pages/<name>";
const <camel>Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/<name>",
  component: <Pascal>Page,
});
// 並把 <camel>Route 加進 rootRoute.addChildren([...])
```

5. 建測試 `src/pages/<name>/<name>-page.test.tsx`，至少驗證標題 render。

## 鐵律
- import 只能往下層；跨 slice 走 `index.ts`；一律用 `@/` 別名。
- 完成後跑 `check` skill 驗收。
