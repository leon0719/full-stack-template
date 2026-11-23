import { cn } from "@/shared/lib";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";
import { aiDemos } from "./ai";
import { displayDemos } from "./display";
import { formDemos } from "./forms";
import { layoutDemos } from "./layout";
import { overlayDemos } from "./overlays";
import { pickerDemos } from "./pickers";
import type { Demo } from "./types";

// 展示頁的範例文字直接寫中文、不走 i18n：這頁是給開發者看的元件型錄，
// 幾百個範例字串放進 locales 只會讓下游專案刪 demo 時多一堆要清的 key。
const CATEGORIES: { id: string; title: string; demos: Demo[] }[] = [
  { id: "forms", title: "表單輸入", demos: formDemos },
  { id: "pickers", title: "選擇器", demos: pickerDemos },
  { id: "overlays", title: "對話框與選單", demos: overlayDemos },
  { id: "layout", title: "導覽與版面", demos: layoutDemos },
  { id: "display", title: "資料呈現與回饋", demos: displayDemos },
  { id: "ai", title: "對話介面（AI）", demos: aiDemos },
];

function anchor(name: string) {
  return `component-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

const navLink =
  "block rounded-sm px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/** 型錄目錄。extra 放頁面自己的區塊(例如整合範例) */
export function GalleryNav({
  className,
  extra,
}: {
  className?: string;
  extra?: { href: string; label: string }[];
}) {
  return (
    <nav aria-label="元件目錄" className={cn("text-sm", className)}>
      {CATEGORIES.map((category) => (
        <div key={category.id} className="mb-5">
          <a href={`#${category.id}`} className="mb-1 block px-2 font-semibold">
            {category.title}
          </a>
          <ul>
            {category.demos.map((demo) => (
              <li key={demo.name}>
                <a href={`#${anchor(demo.name)}`} className={navLink}>
                  {demo.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {extra?.map((item) => (
        <a key={item.href} href={item.href} className="block px-2 font-semibold">
          {item.label}
        </a>
      ))}
    </nav>
  );
}

export function ComponentGallery() {
  return (
    <div className="flex flex-col gap-14">
      {CATEGORIES.map((category) => (
        <section
          key={category.id}
          id={category.id}
          aria-labelledby={`${category.id}-title`}
          className="flex scroll-mt-6 flex-col gap-4"
        >
          <div className="flex items-baseline gap-3 border-b pb-2">
            <h2 id={`${category.id}-title`} className="text-xl font-semibold tracking-tight">
              {category.title}
            </h2>
            <span className="text-sm text-muted-foreground">{category.demos.length} 個元件</span>
          </div>
          {category.demos.map(({ name, description, Component }) => (
            <Card key={name} id={anchor(name)} className="scroll-mt-6">
              <CardHeader>
                <CardTitle>
                  <h3 className="text-base font-semibold">{name}</h3>
                </CardTitle>
                {description && <CardDescription>{description}</CardDescription>}
              </CardHeader>
              <CardContent>
                <Component />
              </CardContent>
            </Card>
          ))}
        </section>
      ))}
    </div>
  );
}
