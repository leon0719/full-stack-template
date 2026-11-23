import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Bold, CalendarIcon, Italic, Underline } from "lucide-react";
import { useState } from "react";
import {
  Button,
  Calendar,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  DirectionProvider,
  Kbd,
  KbdGroup,
  Label,
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
} from "@/shared/ui";
import type { Demo } from "./types";

const CITIES = ["台北市", "新北市", "桃園市", "台中市", "台南市", "高雄市", "新竹市", "基隆市"];

function SelectDemo() {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="gallery-select-fruit">水果</Label>
        <Select>
          <SelectTrigger id="gallery-select-fruit" className="w-44">
            <SelectValue placeholder="請選擇" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>當季</SelectLabel>
              <SelectItem value="mango">芒果</SelectItem>
              <SelectItem value="lychee">荔枝</SelectItem>
              <SelectItem value="durian" disabled>
                榴槤（缺貨）
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <Select defaultValue="m">
        <SelectTrigger size="sm" aria-label="尺寸">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="s">S</SelectItem>
            <SelectItem value="m">M</SelectItem>
            <SelectItem value="l">L</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select disabled>
        <SelectTrigger aria-label="停用的選單">
          <SelectValue placeholder="停用" />
        </SelectTrigger>
        <SelectContent />
      </Select>
    </div>
  );
}

function NativeSelectDemo() {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="gallery-native-select-city">縣市</Label>
        <NativeSelect id="gallery-native-select-city" defaultValue="" className="w-44">
          <NativeSelectOption value="">請選擇</NativeSelectOption>
          <NativeSelectOptGroup label="北部">
            <NativeSelectOption value="tpe">台北市</NativeSelectOption>
            <NativeSelectOption value="ntpc">新北市</NativeSelectOption>
          </NativeSelectOptGroup>
          <NativeSelectOptGroup label="南部">
            <NativeSelectOption value="tnn">台南市</NativeSelectOption>
            <NativeSelectOption value="khh">高雄市</NativeSelectOption>
          </NativeSelectOptGroup>
        </NativeSelect>
      </div>
      <NativeSelect size="sm" aria-label="小尺寸" defaultValue="a">
        <NativeSelectOption value="a">小尺寸</NativeSelectOption>
      </NativeSelect>
      <NativeSelect aria-label="錯誤狀態" aria-invalid defaultValue="">
        <NativeSelectOption value="">錯誤狀態</NativeSelectOption>
      </NativeSelect>
    </div>
  );
}

function ComboboxDemo() {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="gallery-combobox-city">縣市（可輸入篩選）</Label>
      <Combobox items={CITIES}>
        <ComboboxInput id="gallery-combobox-city" placeholder="輸入縣市…" showClear />
        <ComboboxContent>
          <ComboboxEmpty>找不到符合的縣市</ComboboxEmpty>
          <ComboboxList>
            {(city: string) => (
              <ComboboxItem key={city} value={city}>
                {city}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}

function CalendarDemo() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  return (
    <Calendar
      mode="single"
      locale={zhTW}
      selected={date}
      onSelect={setDate}
      className="w-fit rounded-lg border"
    />
  );
}

function DatePickerDemo() {
  const [date, setDate] = useState<Date | undefined>();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="gallery-date-picker-due">到期日</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id="gallery-date-picker-due"
            variant="outline"
            className="w-48 justify-start font-normal"
          >
            <CalendarIcon data-icon="inline-start" />
            {date ? format(date, "yyyy/MM/dd（EEEEE）", { locale: zhTW }) : "選擇日期"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            locale={zhTW}
            selected={date}
            onSelect={(d) => {
              setDate(d);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function ToggleDemo() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Toggle aria-label="粗體">
        <Bold />
      </Toggle>
      <Toggle variant="outline" aria-label="斜體" defaultPressed>
        <Italic />
      </Toggle>
      <Toggle size="sm" variant="outline">
        <Underline data-icon="inline-start" />
        底線
      </Toggle>
      <Toggle disabled aria-label="停用">
        <Bold />
      </Toggle>
    </div>
  );
}

function ToggleGroupDemo() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <ToggleGroup type="multiple" variant="outline" aria-label="文字樣式">
        <ToggleGroupItem value="bold" aria-label="粗體">
          <Bold />
        </ToggleGroupItem>
        <ToggleGroupItem value="italic" aria-label="斜體">
          <Italic />
        </ToggleGroupItem>
        <ToggleGroupItem value="underline" aria-label="底線">
          <Underline />
        </ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup type="single" defaultValue="week" aria-label="檢視範圍">
        <ToggleGroupItem value="day">日</ToggleGroupItem>
        <ToggleGroupItem value="week">週</ToggleGroupItem>
        <ToggleGroupItem value="month">月</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

function KbdDemo() {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        搜尋：
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </p>
      <p>
        儲存：
        <KbdGroup>
          <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd>
        </KbdGroup>
      </p>
    </div>
  );
}

function DirectionDemo() {
  return (
    <DirectionProvider dir="rtl">
      <div dir="rtl" className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">RTL 下 ToggleGroup 的方向鍵與排列會跟著反轉</p>
        <ToggleGroup type="single" defaultValue="a" variant="outline" aria-label="RTL 範例">
          <ToggleGroupItem value="a">א</ToggleGroupItem>
          <ToggleGroupItem value="b">ב</ToggleGroupItem>
          <ToggleGroupItem value="c">ג</ToggleGroupItem>
        </ToggleGroup>
      </div>
    </DirectionProvider>
  );
}

export const pickerDemos: Demo[] = [
  { name: "Select", description: "Radix 下拉選單，可分組、停用選項", Component: SelectDemo },
  {
    name: "Native Select",
    description: "原生 <select>；配 react-hook-form register() 時優先用它，手機用系統選單",
    Component: NativeSelectDemo,
  },
  { name: "Combobox", description: "可輸入篩選的下拉選單（Base UI）", Component: ComboboxDemo },
  {
    name: "Calendar",
    description: "react-day-picker，locale 用 date-fns zhTW",
    Component: CalendarDemo,
  },
  {
    name: "Date Picker",
    description: "Popover + Calendar 組合，不是獨立元件",
    Component: DatePickerDemo,
  },
  { name: "Toggle", description: "單一開關按鈕（aria-pressed）", Component: ToggleDemo },
  { name: "Toggle Group", description: "2–7 個選項的單選 / 多選", Component: ToggleGroupDemo },
  { name: "Kbd", description: "鍵盤按鍵提示", Component: KbdDemo },
  {
    name: "Direction",
    description: "DirectionProvider 讓 Radix 元件知道文字方向（RTL 語系用）",
    Component: DirectionDemo,
  },
];
