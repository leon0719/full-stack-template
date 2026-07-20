import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../config";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const onChange = (e: ChangeEvent<HTMLSelectElement>) => {
    i18n.changeLanguage(e.target.value);
  };

  return (
    <select
      aria-label="Language"
      value={i18n.language}
      onChange={onChange}
      className="h-8 rounded-md border border-foreground/20 bg-background px-2 text-sm"
    >
      {SUPPORTED_LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.label}
        </option>
      ))}
    </select>
  );
}
