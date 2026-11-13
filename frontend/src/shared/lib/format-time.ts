import { i18n } from "@/shared/i18n";

/** 顯示用時區:後端一律回 UTC(含 offset),畫面固定換算成台灣時間,不跟著使用者電腦的時區跑 */
export const DISPLAY_TIME_ZONE = "Asia/Taipei";

export type DateInput = string | number | Date;

interface FormatOptions {
  /** 預設取目前 i18n 語系;要固定格式(例如匯出檔名)時明確指定 */
  locale?: string;
  timeZone?: string;
}

function currentLocale(): string {
  return i18n.resolvedLanguage ?? i18n.language ?? "zh-TW";
}

function toDate(value: DateInput | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Intl formatter 建立成本不低,列表一頁可能格式化上百次:依參數快取
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();
function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = dateTimeFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    dateTimeFormats.set(key, format);
  }
  return format;
}

/** 日期 + 時間(24 小時制),例:zh-TW「2026/11/13 14:05」、en「11/13/2026, 14:05」。
 *  null / undefined / 無效日期回傳空字串,呼叫端自行決定要不要顯示「—」。 */
export function formatDateTime(
  value: DateInput | null | undefined,
  options: FormatOptions & { withSeconds?: boolean } = {},
): string {
  const date = toDate(value);
  if (!date) return "";
  return (
    dateTimeFormat(options.locale ?? currentLocale(), {
      timeZone: options.timeZone ?? DISPLAY_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      ...(options.withSeconds ? { second: "2-digit" } : {}),
      hourCycle: "h23",
    })
      .format(date)
      // 部分語系(含 zh-TW)用細空白/不換行空白分隔日期與時間;換成一般空白,複製貼上與比對才一致
      .replace(/\s/g, " ")
  );
}

/** 只有日期,例:zh-TW「2026/11/13」。跨日邊界依台灣時區判斷(UTC 16:00 之後已是隔天) */
export function formatDate(
  value: DateInput | null | undefined,
  options: FormatOptions = {},
): string {
  const date = toDate(value);
  if (!date) return "";
  return dateTimeFormat(options.locale ?? currentLocale(), {
    timeZone: options.timeZone ?? DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 30],
];

/** 相對時間,例:zh-TW「3 分鐘前」「2 小時後」、en「3 minutes ago」。
 *  45 秒內顯示「現在」;超過 30 天改顯示日期(相對時間太模糊)。 */
export function formatRelativeTime(
  value: DateInput | null | undefined,
  options: FormatOptions & { now?: DateInput } = {},
): string {
  const date = toDate(value);
  if (!date) return "";
  const now = toDate(options.now ?? Date.now()) ?? new Date();
  const locale = options.locale ?? currentLocale();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  let amount = (date.getTime() - now.getTime()) / 1000;
  if (Math.abs(amount) < 45) return rtf.format(0, "second");
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(amount) < size) return rtf.format(Math.trunc(amount), unit);
    amount /= size;
  }
  return formatDate(date, options);
}
