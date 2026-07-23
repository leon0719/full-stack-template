import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// biome-ignore lint/style/noRestrictedImports: main.tsx is the app entry point
import { App } from "@/app";
import { djangoAuthAdapter, setAuthAdapter } from "@/shared/auth";
import { initErrorTracking, installGlobalErrorReporting } from "@/shared/lib";
import "@/index.css";

// 順序有意義:先把 reporter 接上 Sentry,再掛 window 層級的監聽。
// 反過來的話,啟動早期的錯誤只會進到 console。
initErrorTracking();
installGlobalErrorReporting();
setAuthAdapter(djangoAuthAdapter);

// biome-ignore lint/style/noNonNullAssertion: root element is guaranteed to exist in index.html
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
