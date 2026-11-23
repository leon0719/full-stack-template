import { ChevronsUpDown, FolderKanban, Home, Inbox, Settings } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  AspectRatio,
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  Separator,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/ui";
import type { Demo } from "./types";

function AccordionDemo() {
  return (
    <Accordion type="single" collapsible defaultValue="shipping" className="max-w-lg">
      <AccordionItem value="shipping">
        <AccordionTrigger>運費怎麼計算？</AccordionTrigger>
        <AccordionContent>單筆訂單滿 1,000 元免運，未滿收 80 元。</AccordionContent>
      </AccordionItem>
      <AccordionItem value="return">
        <AccordionTrigger>可以退貨嗎？</AccordionTrigger>
        <AccordionContent>收到商品 7 天內可申請退貨，商品需保持完整。</AccordionContent>
      </AccordionItem>
      <AccordionItem value="invoice">
        <AccordionTrigger>發票何時開立？</AccordionTrigger>
        <AccordionContent>出貨後 3 個工作天內寄送電子發票。</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function CollapsibleDemo() {
  return (
    <Collapsible className="flex max-w-sm flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium">已追蹤 3 個專案</p>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="展開專案清單">
            <ChevronsUpDown />
          </Button>
        </CollapsibleTrigger>
      </div>
      <div className="rounded-md border px-3 py-2 font-mono text-sm">project-template</div>
      <CollapsibleContent className="flex flex-col gap-2">
        <div className="rounded-md border px-3 py-2 font-mono text-sm">backend-api</div>
        <div className="rounded-md border px-3 py-2 font-mono text-sm">infra</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function BreadcrumbDemo() {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#">首頁</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbEllipsis />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="#">訂單管理</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>訂單 #1024</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function NavigationMenuDemo() {
  return (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>產品</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-72 gap-1">
              {[
                ["報表中心", "每日營運數據與匯出"],
                ["客戶管理", "名單、標籤與聯絡紀錄"],
                ["排程任務", "定期匯入與通知"],
              ].map(([title, text]) => (
                <li key={title}>
                  <NavigationMenuLink href="#">
                    <span className="font-medium">{title}</span>
                    <span className="text-muted-foreground">{text}</span>
                  </NavigationMenuLink>
                </li>
              ))}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink href="#" className={navigationMenuTriggerStyle()}>
            文件
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}

function PaginationDemo() {
  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" text="上一頁" />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#">1</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" isActive>
            2
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#">3</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis />
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#" text="下一頁" />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

function TabsDemo() {
  return (
    <div className="flex flex-col gap-6">
      <Tabs defaultValue="overview" className="max-w-md">
        <TabsList>
          <TabsTrigger value="overview">概覽</TabsTrigger>
          <TabsTrigger value="settings">設定</TabsTrigger>
          <TabsTrigger value="history">紀錄</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">用 ← → 鍵切換頁籤，Tab 進入內容。</TabsContent>
        <TabsContent value="settings">這裡放專案設定表單。</TabsContent>
        <TabsContent value="history">目前沒有紀錄。</TabsContent>
      </Tabs>
      <Tabs defaultValue="all" className="max-w-md">
        <TabsList variant="line">
          <TabsTrigger value="all">全部</TabsTrigger>
          <TabsTrigger value="open">處理中</TabsTrigger>
          <TabsTrigger value="done">已完成</TabsTrigger>
        </TabsList>
        <TabsContent value="all">variant="line" 的底線樣式。</TabsContent>
        <TabsContent value="open">2 筆處理中。</TabsContent>
        <TabsContent value="done">10 筆已完成。</TabsContent>
      </Tabs>
    </div>
  );
}

const SIDEBAR_ITEMS = [
  { title: "首頁", icon: Home, active: true },
  { title: "收件匣", icon: Inbox, badge: "12" },
  { title: "專案", icon: FolderKanban },
  { title: "設定", icon: Settings },
];

function SidebarDemo() {
  return (
    <div className="h-80 overflow-hidden rounded-lg border">
      {/* 真實版面放在 AppLayout 最外層、不需要 min-h-0;這裡塞進卡片才覆寫 min-h-svh */}
      <SidebarProvider className="min-h-0 h-full">
        <Sidebar collapsible="none" className="border-r">
          <SidebarHeader className="px-4 py-3 font-semibold">Acme 後台</SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>主選單</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {SIDEBAR_ITEMS.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={item.active}>
                        <a href="#component-sidebar">
                          <item.icon />
                          <span>{item.title}</span>
                        </a>
                      </SidebarMenuButton>
                      {item.badge && <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="px-4 py-3 text-xs text-muted-foreground">v1.0.0</SidebarFooter>
        </Sidebar>
        <SidebarInset className="p-4 text-sm text-muted-foreground">
          主內容區（SidebarInset）。正式使用時 collapsible 可改 "icon" / "offcanvas" 並加
          SidebarTrigger。
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}

function ResizableDemo() {
  return (
    <ResizablePanelGroup orientation="horizontal" className="max-w-lg rounded-lg border">
      <ResizablePanel defaultSize="40">
        <div className="flex h-40 items-center justify-center text-sm">清單</div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="60">
        <ResizablePanelGroup orientation="vertical">
          <ResizablePanel defaultSize="50">
            <div className="flex h-full items-center justify-center text-sm">內容</div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="50">
            <div className="flex h-full items-center justify-center text-sm">屬性</div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

const RELEASES = Array.from({ length: 30 }, (_, i) => `v1.${30 - i}.0`);

function ScrollAreaDemo() {
  return (
    <ScrollArea className="h-56 w-48 rounded-md border">
      <div className="p-4">
        <p className="mb-3 text-sm font-medium">版本紀錄</p>
        {RELEASES.map((tag) => (
          <div key={tag}>
            <div className="font-mono text-sm">{tag}</div>
            <Separator className="my-2" />
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function SeparatorDemo() {
  return (
    <div className="max-w-sm">
      <p className="text-sm font-medium">專案範本</p>
      <p className="text-sm text-muted-foreground">React + FSD 前端起始專案</p>
      <Separator className="my-4" />
      <div className="flex h-5 items-center gap-4 text-sm">
        <span>文件</span>
        <Separator orientation="vertical" />
        <span>原始碼</span>
        <Separator orientation="vertical" />
        <span>更新紀錄</span>
      </div>
    </div>
  );
}

function AspectRatioDemo() {
  return (
    <div className="w-full max-w-sm">
      <AspectRatio
        ratio={16 / 9}
        className="flex items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground"
      >
        16 : 9
      </AspectRatio>
    </div>
  );
}

function CarouselDemo() {
  return (
    <Carousel className="mx-12 max-w-xs">
      <CarouselContent>
        {[1, 2, 3, 4, 5].map((n) => (
          <CarouselItem key={n}>
            <div className="flex aspect-square items-center justify-center rounded-lg border text-4xl font-semibold">
              {n}
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  );
}

export const layoutDemos: Demo[] = [
  { name: "Accordion", description: "可展開收合的問答或分段內容", Component: AccordionDemo },
  { name: "Collapsible", description: "單一區塊的展開／收合", Component: CollapsibleDemo },
  { name: "Breadcrumb", description: "目前頁面在網站階層中的位置", Component: BreadcrumbDemo },
  { name: "Navigation Menu", description: "網站頂部的多層導覽選單", Component: NavigationMenuDemo },
  { name: "Pagination", description: "列表分頁", Component: PaginationDemo },
  { name: "Tabs", description: "同一區塊內切換不同內容", Component: TabsDemo },
  {
    name: "Sidebar",
    description: "後台左側導覽；正式使用放在 AppLayout 最外層",
    Component: SidebarDemo,
  },
  { name: "Resizable", description: "可拖拉調整大小的分割面板", Component: ResizableDemo },
  { name: "Scroll Area", description: "跨瀏覽器一致樣式的捲動區", Component: ScrollAreaDemo },
  { name: "Separator", description: "水平／垂直分隔線", Component: SeparatorDemo },
  {
    name: "Aspect Ratio",
    description: "固定長寬比的容器（影片、圖片）",
    Component: AspectRatioDemo,
  },
  { name: "Carousel", description: "輪播（Embla）", Component: CarouselDemo },
];
