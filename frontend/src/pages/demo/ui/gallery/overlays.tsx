import { Calculator, Calendar, Settings, Smile, Trash2, User } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Avatar,
  AvatarFallback,
  Button,
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
  confirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Input,
  Kbd,
  KbdGroup,
  Label,
  Menubar,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from "@/shared/ui";
import type { Demo } from "./types";

function DialogDemo() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">編輯個人資料</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>編輯個人資料</DialogTitle>
          <DialogDescription>修改後按「儲存」生效。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="gallery-dialog-name">顯示名稱</Label>
          <Input id="gallery-dialog-name" defaultValue="王小明" />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">取消</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button>儲存</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AlertDialogDemo() {
  const [answer, setAnswer] = useState<string | null>(null);
  const ask = async (danger: boolean) => {
    const ok = await confirmDialog(
      danger
        ? { message: "確定要刪除這筆資料嗎？刪除後無法復原。", confirmLabel: "刪除", danger: true }
        : { message: "確定要套用這個設定嗎？" },
    );
    setAnswer(ok ? "已確認" : "已取消");
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline">元件組合寫法</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清除快取？</AlertDialogTitle>
            <AlertDialogDescription>需要自訂內容時直接組 AlertDialog。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction>清除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Button variant="outline" onClick={() => ask(false)}>
        await confirmDialog()
      </Button>
      <Button variant="destructive" onClick={() => ask(true)}>
        <Trash2 data-icon="inline-start" />
        刪除（danger）
      </Button>
      {answer && <span className="text-sm text-muted-foreground">{answer}</span>}
    </div>
  );
}

function SheetDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      {(["right", "left", "top", "bottom"] as const).map((side) => (
        <Sheet key={side}>
          <SheetTrigger asChild>
            <Button variant="outline">{side}</Button>
          </SheetTrigger>
          <SheetContent side={side}>
            <SheetHeader>
              <SheetTitle>篩選條件</SheetTitle>
              <SheetDescription>從 {side} 滑出的側邊面板。</SheetDescription>
            </SheetHeader>
            <SheetFooter>
              <SheetClose asChild>
                <Button>套用</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ))}
    </div>
  );
}

function DrawerDemo() {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="outline">開啟 Drawer</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>設定每日目標</DrawerTitle>
          <DrawerDescription>手機上適合用底部抽屜，可往下滑關閉。</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button>確定</Button>
          <DrawerClose asChild>
            <Button variant="outline">取消</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function PopoverDemo() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">調整尺寸</Button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <PopoverHeader>
          <PopoverTitle>尺寸</PopoverTitle>
          <PopoverDescription>設定圖層的寬與高。</PopoverDescription>
        </PopoverHeader>
        <div className="grid grid-cols-3 items-center gap-2">
          <Label htmlFor="gallery-popover-width">寬</Label>
          <Input id="gallery-popover-width" defaultValue="100%" className="col-span-2" />
          <Label htmlFor="gallery-popover-height">高</Label>
          <Input id="gallery-popover-height" defaultValue="25px" className="col-span-2" />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TooltipDemo() {
  return (
    // 展示頁測試是單獨 render 頁面,沒有 entrypoint 的 Provider,這裡自己包
    <TooltipProvider>
      <div className="flex gap-2">
        {(["top", "right", "bottom", "left"] as const).map((side) => (
          <Tooltip key={side}>
            <TooltipTrigger asChild>
              <Button variant="outline">{side}</Button>
            </TooltipTrigger>
            <TooltipContent side={side}>加入收藏</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

function HoverCardDemo() {
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Button variant="link">@react-fsd</Button>
      </HoverCardTrigger>
      <HoverCardContent className="w-72">
        <div className="flex gap-3">
          <Avatar>
            <AvatarFallback>RF</AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-medium">React FSD Template</p>
            <p className="text-muted-foreground">滑鼠移上去才顯示的預覽卡。</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="size-3" />
              2026 年 11 月建立
            </p>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function DropdownMenuDemo() {
  const [showStatus, setShowStatus] = useState(true);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">我的帳號</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start">
        <DropdownMenuLabel>帳號</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <User />
            個人資料
            <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Settings />
            設定
            <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem checked={showStatus} onCheckedChange={setShowStatus}>
            顯示狀態列
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive">登出</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ContextMenuDemo() {
  const [bookmarked, setBookmarked] = useState(false);
  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-32 w-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        在這裡按右鍵（觸控裝置長按）
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuGroup>
          <ContextMenuItem>
            上一頁
            <ContextMenuShortcut>⌘[</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem>
            重新整理
            <ContextMenuShortcut>⌘R</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuCheckboxItem checked={bookmarked} onCheckedChange={setBookmarked}>
            加入書籤
          </ContextMenuCheckboxItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function MenubarDemo() {
  return (
    <Menubar className="w-fit">
      <MenubarMenu>
        <MenubarTrigger>檔案</MenubarTrigger>
        <MenubarContent>
          <MenubarGroup>
            <MenubarItem>
              新增分頁 <MenubarShortcut>⌘T</MenubarShortcut>
            </MenubarItem>
            <MenubarItem>
              新增視窗 <MenubarShortcut>⌘N</MenubarShortcut>
            </MenubarItem>
          </MenubarGroup>
          <MenubarSeparator />
          <MenubarGroup>
            <MenubarItem>列印</MenubarItem>
          </MenubarGroup>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>編輯</MenubarTrigger>
        <MenubarContent>
          <MenubarGroup>
            <MenubarItem>
              復原 <MenubarShortcut>⌘Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem>
              重做 <MenubarShortcut>⇧⌘Z</MenubarShortcut>
            </MenubarItem>
          </MenubarGroup>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}

function CommandItems() {
  return (
    <>
      <CommandEmpty>找不到符合的項目。</CommandEmpty>
      <CommandGroup heading="建議">
        <CommandItem>
          <Calendar />
          行事曆
        </CommandItem>
        <CommandItem>
          <Smile />
          表情符號
        </CommandItem>
        <CommandItem>
          <Calculator />
          計算機
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="設定">
        <CommandItem>
          <User />
          個人資料
          <CommandShortcut>⌘P</CommandShortcut>
        </CommandItem>
        <CommandItem>
          <Settings />
          偏好設定
          <CommandShortcut>⌘S</CommandShortcut>
        </CommandItem>
      </CommandGroup>
    </>
  );
}

function CommandDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Command className="max-w-md rounded-lg border">
        <CommandInput placeholder="輸入指令或搜尋…" />
        <CommandList>
          <CommandItems />
        </CommandList>
      </Command>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Button variant="outline" onClick={() => setOpen(true)}>
          開啟指令面板
        </Button>
        實務上綁
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </div>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="指令面板"
        description="搜尋要執行的指令"
      >
        <Command>
          <CommandInput placeholder="輸入指令或搜尋…" />
          <CommandList>
            <CommandItems />
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  );
}

function ToastDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => toast("這是一則提示訊息")}>
        toast()
      </Button>
      <Button variant="outline" onClick={() => toast.success("已儲存")}>
        success
      </Button>
      <Button variant="outline" onClick={() => toast.error("儲存失敗，請稍後再試")}>
        error
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast("已刪除 1 筆資料", { action: { label: "復原", onClick: () => toast("已復原") } })
        }
      >
        含動作
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.promise(new Promise((resolve) => setTimeout(resolve, 1500)), {
            loading: "處理中…",
            success: "完成",
            error: "失敗",
          })
        }
      >
        promise
      </Button>
    </div>
  );
}

export const overlayDemos: Demo[] = [
  { name: "Dialog", description: "一般用途的對話框，內容可放表單。", Component: DialogDemo },
  {
    name: "Alert Dialog",
    description: "需要使用者明確回應的確認框；簡單確認用 await confirmDialog()。",
    Component: AlertDialogDemo,
  },
  {
    name: "Sheet",
    description: "從畫面邊緣滑出的面板，適合篩選、細節檢視。",
    Component: SheetDemo,
  },
  { name: "Drawer", description: "底部抽屜（vaul），手機上可滑動關閉。", Component: DrawerDemo },
  { name: "Popover", description: "點擊後浮出的小面板。", Component: PopoverDemo },
  { name: "Tooltip", description: "滑鼠移上或鍵盤聚焦時的簡短說明。", Component: TooltipDemo },
  { name: "Hover Card", description: "滑鼠移上連結時的預覽卡。", Component: HoverCardDemo },
  { name: "Dropdown Menu", description: "按鈕觸發的動作選單。", Component: DropdownMenuDemo },
  { name: "Context Menu", description: "右鍵選單。", Component: ContextMenuDemo },
  { name: "Menubar", description: "桌面應用程式風格的選單列。", Component: MenubarDemo },
  {
    name: "Command",
    description: "可搜尋的指令清單（cmdk），常放進 CommandDialog 當 ⌘K 面板。",
    Component: CommandDemo,
  },
  {
    name: "Toast",
    description: "sonner；掛載點 <Toaster /> 在 app/entrypoint.tsx。",
    Component: ToastDemo,
  },
];
