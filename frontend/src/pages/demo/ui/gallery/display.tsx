import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  BadgeCheck,
  ChevronRight,
  CircleAlert,
  FolderOpen,
  Info,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { formatDateTime } from "@/shared/lib";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  Checkbox,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  ErrorState,
  Field,
  FieldLabel,
  FileDropzone,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Progress,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui";
import type { Demo } from "./types";

function AlertDemo() {
  return (
    <div className="flex flex-col gap-3">
      <Alert>
        <Info />
        <AlertTitle>系統將於今晚 23:00 維護</AlertTitle>
        <AlertDescription>維護期間約 30 分鐘，請提前儲存工作。</AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>付款失敗</AlertTitle>
        <AlertDescription>信用卡已過期，請更新付款方式後再試一次。</AlertDescription>
      </Alert>
    </div>
  );
}

function AvatarDemo() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* 圖片載入失敗(這裡故意給不存在的路徑)時自動顯示 fallback */}
      <Avatar>
        <AvatarImage src="/missing-avatar.png" alt="王小明" />
        <AvatarFallback>王</AvatarFallback>
      </Avatar>
      <Avatar size="lg">
        <AvatarFallback>林</AvatarFallback>
        <AvatarBadge className="bg-success" />
      </Avatar>
      <Avatar size="sm">
        <AvatarFallback>陳</AvatarFallback>
      </Avatar>
      <AvatarGroup>
        <Avatar>
          <AvatarFallback>A</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>B</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>C</AvatarFallback>
        </Avatar>
        <AvatarGroupCount>+5</AvatarGroupCount>
      </AvatarGroup>
    </div>
  );
}

function BadgeDemo() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>default</Badge>
      <Badge variant="secondary">secondary</Badge>
      <Badge variant="outline">outline</Badge>
      <Badge variant="destructive">destructive</Badge>
      <Badge variant="success">success</Badge>
      <Badge variant="warning">warning</Badge>
      <Badge variant="info">info</Badge>
      <Badge variant="secondary">
        <BadgeCheck data-icon="inline-start" />
        已驗證
      </Badge>
    </div>
  );
}

function CardDemo() {
  return (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>本月營收</CardTitle>
        <CardDescription>2026 年 11 月，截至今日</CardDescription>
        <CardAction>
          <Badge variant="success">+12%</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums">NT$ 1,284,000</p>
      </CardContent>
      <CardFooter>
        <Button variant="outline" size="sm">
          查看明細
        </Button>
      </CardFooter>
    </Card>
  );
}

type JobStatus = "succeeded" | "running" | "failed";
const STATUS: Record<JobStatus, { label: string; variant: "success" | "info" | "destructive" }> = {
  succeeded: { label: "已完成", variant: "success" },
  running: { label: "處理中", variant: "info" },
  failed: { label: "失敗", variant: "destructive" },
};

const JOBS: { id: number; name: string; status: JobStatus; updatedAt: string }[] = [
  { id: 1, name: "import-users.csv", status: "succeeded", updatedAt: "2026-11-20T09:12:00+08:00" },
  { id: 2, name: "monthly-report.xlsx", status: "running", updatedAt: "2026-11-23T08:40:00+08:00" },
  { id: 3, name: "sync-orders", status: "failed", updatedAt: "2026-11-22T17:05:00+08:00" },
];

function TableDemo() {
  return (
    <Table>
      <TableCaption>最近的任務</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>名稱</TableHead>
          <TableHead>狀態</TableHead>
          <TableHead className="text-right">更新時間</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {JOBS.map((job) => (
          <TableRow key={job.id}>
            <TableCell className="font-mono">{job.name}</TableCell>
            <TableCell>
              <Badge variant={STATUS[job.status].variant}>{STATUS[job.status].label}</Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatDateTime(job.updatedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

interface Member {
  name: string;
  email: string;
  role: "管理員" | "編輯" | "檢視者";
  orders: number;
}

const MEMBERS: Member[] = [
  { name: "王小明", email: "ming@example.com", role: "管理員", orders: 42 },
  { name: "林美玲", email: "meiling@example.com", role: "編輯", orders: 18 },
  { name: "陳志豪", email: "chihhao@example.com", role: "檢視者", orders: 7 },
  { name: "張雅婷", email: "yating@example.com", role: "編輯", orders: 25 },
  { name: "李建宏", email: "chienhung@example.com", role: "檢視者", orders: 3 },
  { name: "黃怡君", email: "yichun@example.com", role: "管理員", orders: 31 },
  { name: "吳承恩", email: "chengen@example.com", role: "編輯", orders: 12 },
  { name: "劉家豪", email: "chiahao@example.com", role: "檢視者", orders: 9 },
  { name: "蔡佩珊", email: "peishan@example.com", role: "編輯", orders: 20 },
];

// @tanstack/react-table v9:用到的功能要明確註冊(tree-shaking),features / columns 放在模組層保持穩定
const MEMBER_FEATURES = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  rowSelectionFeature,
});

const member = createColumnHelper<typeof MEMBER_FEATURES, Member>();

const MEMBER_COLUMNS = member.columns([
  member.display({
    id: "select",
    header: ({ table }) => (
      <Checkbox
        aria-label="全選本頁"
        checked={
          table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={`選取 ${row.original.name}`}
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
      />
    ),
  }),
  member.accessor("name", { header: "姓名" }),
  member.accessor("email", { header: "Email" }),
  member.accessor("role", { header: "角色" }),
  member.accessor("orders", {
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        訂單數
        <ArrowUpDown data-icon="inline-end" />
      </Button>
    ),
    cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span>,
  }),
]);

function DataTableDemo() {
  const table = useTable({
    features: MEMBER_FEATURES,
    columns: MEMBER_COLUMNS,
    data: MEMBERS,
    getRowId: (row) => row.email,
    globalFilterFn: "includesString",
    initialState: { pagination: { pageIndex: 0, pageSize: 5 } },
  });
  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-3">
      <Input
        aria-label="搜尋成員"
        placeholder="搜尋姓名、Email、角色…"
        value={table.state.globalFilter ?? ""}
        onChange={(e) => table.setGlobalFilter(e.target.value)}
        className="max-w-xs"
      />
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={MEMBER_COLUMNS.length} className="h-20 text-center">
                  沒有符合的成員
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          已選取 {table.getFilteredSelectedRowModel().rows.length} /{" "}
          {table.getFilteredRowModel().rows.length} 筆
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            上一頁
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            下一頁
          </Button>
        </div>
      </div>
    </div>
  );
}

const SALES = [
  { month: "6 月", online: 186, store: 80 },
  { month: "7 月", online: 305, store: 200 },
  { month: "8 月", online: 237, store: 120 },
  { month: "9 月", online: 173, store: 190 },
  { month: "10 月", online: 209, store: 130 },
  { month: "11 月", online: 254, store: 140 },
];

const SALES_CONFIG = {
  online: { label: "線上", color: "var(--chart-1)" },
  store: { label: "門市", color: "var(--chart-2)" },
} satisfies ChartConfig;

function ChartDemo() {
  return (
    <ChartContainer config={SALES_CONFIG} className="aspect-auto h-64 w-full">
      <BarChart accessibilityLayer data={SALES}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="online" fill="var(--color-online)" radius={4} />
        <Bar dataKey="store" fill="var(--color-store)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}

function EmptyDemo() {
  const [retries, setRetries] = useState(0);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderOpen />
          </EmptyMedia>
          <EmptyTitle>還沒有專案</EmptyTitle>
          <EmptyDescription>建立第一個專案後會顯示在這裡。</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm">
            <Plus data-icon="inline-start" />
            新增專案
          </Button>
        </EmptyContent>
      </Empty>
      {/* 本模板自製:載入失敗版面,以 Empty 組成 */}
      <ErrorState
        description={retries > 0 ? `已重試 ${retries} 次` : "伺服器暫時沒有回應。"}
        onRetry={() => setRetries((n) => n + 1)}
      />
    </div>
  );
}

function SkeletonDemo() {
  return (
    <div className="flex items-center gap-4">
      <Skeleton className="size-12 rounded-full" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  );
}

function SpinnerDemo() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Spinner />
      <Spinner className="size-6" />
      {/* 按鈕裡已有文字:label="" 讓 Spinner 變純裝飾,並 disabled 防止重複送出 */}
      <Button disabled>
        <Spinner label="" data-icon="inline-start" />
        儲存中…
      </Button>
      <Button variant="outline" disabled>
        <Spinner label="" data-icon="inline-start" />
        匯出中…
      </Button>
    </div>
  );
}

function ProgressDemo() {
  return (
    <div className="flex max-w-sm flex-col gap-2">
      <div className="flex justify-between text-sm">
        <span>上傳 report.xlsx</span>
        <span className="tabular-nums text-muted-foreground">66%</span>
      </div>
      <Progress value={66} aria-label="範例上傳進度" />
    </div>
  );
}

function ItemDemo() {
  return (
    <div className="flex max-w-md flex-col gap-3">
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>雙重驗證</ItemTitle>
          <ItemDescription>登入時除了密碼，還需要輸入手機上的驗證碼。</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button variant="outline" size="sm">
            啟用
          </Button>
        </ItemActions>
      </Item>
      <Item variant="muted" size="sm" asChild>
        <a href="#gallery-item-profile">
          <ItemMedia variant="icon">
            <BadgeCheck />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>帳號已驗證</ItemTitle>
          </ItemContent>
          <ItemActions>
            <ChevronRight className="size-4" />
          </ItemActions>
        </a>
      </Item>
    </div>
  );
}

// shadcn 沒有 Typography 元件,官方做法是直接用 Tailwind class。
// 頁面已有 h1 / h2 / h3,這裡的大標用 <p> 只示範字級,實際使用時換成正確層級的 heading。
function TypographyDemo() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-4xl font-extrabold tracking-tight text-balance">h1 · 年度報告</p>
      <p className="border-b pb-2 text-3xl font-semibold tracking-tight">h2 · 營運摘要</p>
      <p className="text-2xl font-semibold tracking-tight">h3 · 第四季重點</p>
      <p className="text-xl font-semibold tracking-tight">h4 · 新功能上線</p>
      <p className="leading-7">
        本季完成會員系統改版，註冊轉換率提升 12%。內文段落用{" "}
        <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold">
          leading-7
        </code>{" "}
        保持易讀的行高。
      </p>
      <blockquote className="border-l-2 pl-6 italic">「先求有，再求好，但別忘了求好。」</blockquote>
      <ul className="ml-6 list-disc [&>li]:mt-2">
        <li>會員系統改版</li>
        <li>報表匯出加速</li>
        <li>行動版介面優化</li>
      </ul>
      <p className="text-sm text-muted-foreground">muted · 最後更新於 2026/11/23</p>
    </div>
  );
}

function FileDropzoneDemo() {
  const [names, setNames] = useState<string[]>([]);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="gallery-dropzone-file">附件</FieldLabel>
          <FileDropzone
            id="gallery-dropzone-file"
            accept=".pdf,image/*"
            maxSize={10 * 1024 * 1024}
            multiple
            maxFiles={3}
            onFiles={(files) => setNames(files.map((f) => f.name))}
          />
        </Field>
        <Field data-disabled>
          <FieldLabel htmlFor="gallery-dropzone-disabled">附件（停用）</FieldLabel>
          <FileDropzone id="gallery-dropzone-disabled" onFiles={() => {}} disabled />
        </Field>
      </div>
      {names.length > 0 && (
        <p className="text-sm text-muted-foreground">已選擇：{names.join(", ")}</p>
      )}
    </div>
  );
}

export const displayDemos: Demo[] = [
  { name: "Alert", description: "頁面內的提示訊息(callout),不會自動消失。", Component: AlertDemo },
  {
    name: "Avatar",
    description: "使用者頭像；圖片載入失敗時顯示 fallback。",
    Component: AvatarDemo,
  },
  {
    name: "Badge",
    description: "狀態標籤。success / warning / info 是本模板加的狀態色。",
    Component: BadgeDemo,
  },
  {
    name: "Card",
    description: "區塊容器，使用完整的 Header / Content / Footer 組合。",
    Component: CardDemo,
  },
  { name: "Table", description: "原生 table 套樣式，適合靜態資料。", Component: TableDemo },
  {
    name: "Data Table",
    description: "Table + @tanstack/react-table：排序、搜尋、分頁、列選取。",
    Component: DataTableDemo,
  },
  { name: "Chart", description: "包裝 recharts，顏色走 --chart-* token。", Component: ChartDemo },
  {
    name: "Empty",
    description: "無資料版面；旁邊是本模板以 Empty 組成的 ErrorState。",
    Component: EmptyDemo,
  },
  { name: "Skeleton", description: "資料還沒回來時的版面佔位。", Component: SkeletonDemo },
  {
    name: "Spinner",
    description: '載入指示；按鈕內用 label="" 當裝飾並 disabled。',
    Component: SpinnerDemo,
  },
  {
    name: "Progress",
    description: "已知進度的進度條，記得給 aria-label。",
    Component: ProgressDemo,
  },
  { name: "Item", description: "清單列：媒體 + 內容 + 動作。", Component: ItemDemo },
  {
    name: "Typography",
    description: "沒有元件，直接用 Tailwind class 排版。",
    Component: TypographyDemo,
  },
  {
    name: "FileDropzone",
    description: "本模板自製：拖放 + 點選選檔，檢查格式與大小。",
    Component: FileDropzoneDemo,
  },
];
