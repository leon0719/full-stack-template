import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import { initAuth } from "@/shared/auth";
import { i18n } from "@/shared/i18n";
import { queryClient } from "@/shared/lib";
import { ErrorBoundary } from "@/shared/ui";
import { router } from "./router";

export function App() {
  useEffect(() => {
    initAuth();
  }, []);

  return (
    <ErrorBoundary>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>
    </ErrorBoundary>
  );
}
