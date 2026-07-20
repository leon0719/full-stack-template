import { afterEach, describe, expect, it } from "vitest";
import { i18n, SUPPORTED_LANGUAGES } from "./index";

describe("i18n config", () => {
  afterEach(() => {
    i18n.changeLanguage("zh-TW");
  });

  it("exposes the supported languages", () => {
    expect(SUPPORTED_LANGUAGES.map((l) => l.code)).toEqual(["zh-TW", "en"]);
  });

  it("resolves zh-TW strings by default", () => {
    expect(i18n.t("common.logout")).toBe("登出");
    expect(i18n.t("auth.login.failed")).toBe("帳號或密碼錯誤");
  });

  it("resolves en strings after switching language", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("common.logout")).toBe("Logout");
  });

  it("interpolates values", () => {
    expect(i18n.t("pages.demo.form.greeting", { name: "Ada" })).toBe("Hello, Ada");
  });
});
