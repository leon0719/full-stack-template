import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "../config";
import { LanguageSwitcher } from "./language-switcher";

describe("LanguageSwitcher", () => {
  afterEach(async () => {
    await i18n.changeLanguage("zh-TW");
  });

  it("shows the current language and lists all supported languages", () => {
    render(<LanguageSwitcher />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("zh-TW");
    expect(screen.getByRole("option", { name: "繁體中文" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "English" })).toBeInTheDocument();
  });

  it("changes the language on selection", async () => {
    render(<LanguageSwitcher />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "en");
    expect(i18n.language).toBe("en");
  });
});
