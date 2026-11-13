import "@testing-library/jest-dom/vitest";
import { i18n } from "@/shared/i18n";

// jsdom's navigator.language is usually en-US; force the default to zh-TW so
// existing tests that assert Traditional-Chinese strings resolve correctly.
// Safe to not await: resources are bundled inline (synchronous), so the language
// switch completes before any test renders.
i18n.changeLanguage("zh-TW");

// jsdom 沒有實作 <dialog> 的 modal API:補最小 polyfill(只切 open 屬性,不模擬 inert/焦點鎖定)。
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
  this.removeAttribute("open");
  this.dispatchEvent(new Event("close"));
};
