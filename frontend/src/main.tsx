import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// biome-ignore lint/style/noRestrictedImports: main.tsx is the app entry point
import { App } from "@/app";
import { djangoAuthAdapter, setAuthAdapter } from "@/shared/auth";
import { installGlobalErrorReporting } from "@/shared/lib";
import "@/index.css";

installGlobalErrorReporting();
setAuthAdapter(djangoAuthAdapter);

// biome-ignore lint/style/noNonNullAssertion: root element is guaranteed to exist in index.html
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
