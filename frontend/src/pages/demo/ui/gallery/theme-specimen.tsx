import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/shared/lib";
import { Button } from "@/shared/ui";

// 每個色票對應 src/index.css 的一個 token;品牌化時改 token,這裡跟著變
const SWATCHES = [
  { token: "--primary", label: "主色（靛藍）", className: "bg-primary" },
  { token: "--ring", label: "焦點與重點（薑黃）", className: "bg-ring" },
  { token: "--foreground", label: "文字（墨藍）", className: "bg-foreground" },
  { token: "--muted", label: "次要底色", className: "bg-muted" },
  { token: "--success", label: "成功", className: "bg-success" },
  { token: "--warning", label: "警告", className: "bg-warning" },
  { token: "--info", label: "資訊", className: "bg-info" },
  { token: "--destructive", label: "危險", className: "bg-destructive" },
];

function Token({ children }: { children: string }) {
  return <code className="font-mono text-[0.9em] whitespace-nowrap">{children}</code>;
}

/** 深色預覽:切換 <html> 的 .dark;離開頁面時還原 */
function useDarkPreview() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);
  return [dark, setDark] as const;
}

export function ThemeSpecimen() {
  const [dark, setDark] = useDarkPreview();

  return (
    <section aria-labelledby="theme-specimen" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="theme-specimen" className="text-xl font-semibold tracking-tight">
            主題：藍染
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            靛藍當主色、薑黃標示焦點與重點，其餘維持中性。顏色都來自 <Token>src/index.css</Token> 的
            token，換品牌色時從 <Token>--primary</Token> 與 <Token>--ring</Token> 開始改。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setDark((v) => !v)}>
          {dark ? <Sun data-icon="inline-start" /> : <Moon data-icon="inline-start" />}
          {dark ? "切回淺色" : "預覽深色模式"}
        </Button>
      </div>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
        {SWATCHES.map((swatch) => (
          <li key={swatch.token} className="flex flex-col gap-2">
            <span
              aria-hidden
              className={cn(
                "h-14 rounded-md ring-1 ring-foreground/10 ring-inset",
                swatch.className,
              )}
            />
            <span className="text-sm font-medium">{swatch.label}</span>
            <code className="-mt-1.5 font-mono text-xs text-muted-foreground">{swatch.token}</code>
          </li>
        ))}
      </ul>

      <div className="grid gap-6 border-t pt-6 sm:grid-cols-[1fr_auto] sm:items-end">
        <p className="text-4xl leading-tight font-semibold tracking-tight text-balance">
          靛藍染布 Indigo 0123456789
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">英數</dt>
          <dd>IBM Plex Sans</dd>
          <dt className="text-muted-foreground">中文</dt>
          <dd>系統字型（蘋方、微軟正黑體）</dd>
          <dt className="text-muted-foreground">程式碼</dt>
          <dd className="font-mono">IBM Plex Mono</dd>
        </dl>
      </div>
    </section>
  );
}
