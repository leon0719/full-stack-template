import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
// 直接引 cn,不走 @/shared/lib barrel:i18n 被測試 setup 最先載入,走 barrel 會連帶提早載入
// error-tracking 等模組,讓各測試檔的 vi.mock 來不及生效
import { cn } from "@/shared/lib/cn";
import { SUPPORTED_LANGUAGES } from "../config";

/** 預設樣式給淺色背景;放在深色導覽列時用 className 覆寫 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n } = useTranslation();

  const onChange = (e: ChangeEvent<HTMLSelectElement>) => {
    i18n.changeLanguage(e.target.value);
  };

  return (
    <select
      aria-label="Language"
      value={i18n.language}
      onChange={onChange}
      className={cn(
        "h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      {SUPPORTED_LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.label}
        </option>
      ))}
    </select>
  );
}
