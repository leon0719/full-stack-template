import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  type RouterHistory,
  redirect,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { initAuth, useAuthStore } from "@/shared/auth";
import { AppLayout } from "@/shared/ui";

function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="p-8 text-center">
      <h1 className="text-lg font-medium">{t("common.notFound.title")}</h1>
      <p className="text-foreground/60">{t("common.notFound.description")}</p>
    </div>
  );
}

const rootRoute = createRootRoute({ component: AppLayout });

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: lazyRouteComponent(() => import("@/pages/home"), "HomePage"),
});
const demoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/demo",
  component: lazyRouteComponent(() => import("@/pages/demo"), "DemoPage"),
});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: async () => {
    await initAuth();
    if (useAuthStore.getState().status === "authenticated") {
      throw redirect({ to: "/" });
    }
  },
  component: lazyRouteComponent(() => import("@/pages/login"), "LoginPage"),
});
const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  beforeLoad: async () => {
    await initAuth();
    if (useAuthStore.getState().status !== "authenticated") {
      throw redirect({ to: "/login" });
    }
  },
  component: lazyRouteComponent(() => import("@/pages/admin"), "AdminPage"),
});

const routeTree = rootRoute.addChildren([homeRoute, demoRoute, loginRoute, adminRoute]);

export function createAppRouter(options?: { history?: RouterHistory }) {
  return createRouter({
    routeTree,
    defaultNotFoundComponent: NotFoundPage,
    history: options?.history,
  });
}

export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
