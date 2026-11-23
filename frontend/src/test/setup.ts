import "@testing-library/jest-dom/vitest";
import { i18n } from "@/shared/i18n";

// jsdom's navigator.language is usually en-US; force the default to zh-TW so
// existing tests that assert Traditional-Chinese strings resolve correctly.
// Safe to not await: resources are bundled inline (synchronous), so the language
// switch completes before any test renders.
i18n.changeLanguage("zh-TW");

// jsdom 缺的瀏覽器 API(Radix、cmdk、embla、react-resizable-panels、Sidebar 會用到):補到「能 render、不丟錯」為止,
// 不模擬真實行為。要測尺寸 / 捲動相關邏輯請改用 Playwright。
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver;
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
Element.prototype.scrollIntoView ??= () => {};
