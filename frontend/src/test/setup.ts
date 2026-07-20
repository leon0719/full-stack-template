import "@testing-library/jest-dom/vitest";
import { i18n } from "@/shared/i18n";

// jsdom's navigator.language is usually en-US; force the default to zh-TW so
// existing tests that assert Traditional-Chinese strings resolve correctly.
// Safe to not await: resources are bundled inline (synchronous), so the language
// switch completes before any test renders.
i18n.changeLanguage("zh-TW");
