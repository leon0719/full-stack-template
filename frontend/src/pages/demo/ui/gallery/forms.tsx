import {
  ArrowRight,
  Bold,
  Check,
  Copy,
  Italic,
  Mail,
  Plus,
  Search,
  Trash2,
  Underline,
} from "lucide-react";
import { useState } from "react";
import {
  Button,
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  Checkbox,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
  Label,
  RadioGroup,
  RadioGroupItem,
  Slider,
  Spinner,
  Switch,
  Textarea,
} from "@/shared/ui";
import type { Demo } from "./types";

function ButtonDemo() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button>default</Button>
        <Button variant="secondary">secondary</Button>
        <Button variant="outline">outline</Button>
        <Button variant="ghost">ghost</Button>
        <Button variant="destructive">destructive</Button>
        <Button variant="link">link</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="xs">xs</Button>
        <Button size="sm">sm</Button>
        <Button>default</Button>
        <Button size="lg">lg</Button>
        <Button size="icon" variant="outline" aria-label="新增">
          <Plus />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled>停用</Button>
        <Button disabled>
          <Spinner label="" data-icon="inline-start" />
          儲存中…
        </Button>
        <Button variant="outline">
          下一步
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  );
}

function ButtonGroupDemo() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <ButtonGroup aria-label="文字樣式">
        <Button variant="outline" size="icon" aria-label="粗體">
          <Bold />
        </Button>
        <Button variant="outline" size="icon" aria-label="斜體">
          <Italic />
        </Button>
        <Button variant="outline" size="icon" aria-label="底線">
          <Underline />
        </Button>
      </ButtonGroup>
      <ButtonGroup>
        <Button variant="outline">複製</Button>
        <ButtonGroupSeparator />
        <Button variant="outline" size="icon" aria-label="刪除">
          <Trash2 />
        </Button>
      </ButtonGroup>
      <ButtonGroup>
        <ButtonGroupText>https://</ButtonGroupText>
        <Input aria-label="網址" placeholder="example.com" className="w-40" />
      </ButtonGroup>
      <ButtonGroup orientation="vertical" aria-label="數量">
        <Button variant="outline" size="sm">
          +1
        </Button>
        <Button variant="outline" size="sm">
          -1
        </Button>
      </ButtonGroup>
    </div>
  );
}

function InputDemo() {
  return (
    <FieldGroup className="max-w-sm">
      <Field>
        <FieldLabel htmlFor="gallery-input-email">Email</FieldLabel>
        <Input id="gallery-input-email" type="email" placeholder="name@example.com" />
      </Field>
      <Field data-invalid>
        <FieldLabel htmlFor="gallery-input-invalid">帳號</FieldLabel>
        <Input id="gallery-input-invalid" defaultValue="admin" aria-invalid />
        <FieldError>這個帳號已被使用</FieldError>
      </Field>
      <Field data-disabled>
        <FieldLabel htmlFor="gallery-input-disabled">建立者</FieldLabel>
        <Input id="gallery-input-disabled" defaultValue="system" disabled />
      </Field>
      <Field>
        <FieldLabel htmlFor="gallery-input-file">附件</FieldLabel>
        <Input id="gallery-input-file" type="file" />
      </Field>
    </FieldGroup>
  );
}

function InputGroupDemo() {
  const [copied, setCopied] = useState(false);
  return (
    <FieldGroup className="max-w-sm">
      <InputGroup>
        <InputGroupInput aria-label="搜尋" placeholder="搜尋…" />
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupAddon align="inline-end">12 筆</InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>NT$</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput aria-label="金額" placeholder="0" inputMode="decimal" />
        <InputGroupAddon align="inline-end">
          <InputGroupText>元</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupInput aria-label="分享連結" readOnly defaultValue="https://example.com/s/abc" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="複製連結" onClick={() => setCopied(true)}>
            {copied ? <Check /> : <Copy />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupTextarea aria-label="留言" placeholder="寫點什麼…" />
        <InputGroupAddon align="block-end" className="border-t">
          <InputGroupText>0 / 200</InputGroupText>
          <InputGroupButton variant="default" size="sm" className="ml-auto">
            發佈
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </FieldGroup>
  );
}

function InputOtpDemo() {
  const [value, setValue] = useState("");
  return (
    <Field className="w-fit">
      <FieldLabel htmlFor="gallery-otp-code">驗證碼</FieldLabel>
      <InputOTP id="gallery-otp-code" maxLength={6} value={value} onChange={setValue}>
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
          <InputOTPSlot index={2} />
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup>
          <InputOTPSlot index={3} />
          <InputOTPSlot index={4} />
          <InputOTPSlot index={5} />
        </InputOTPGroup>
      </InputOTP>
      <FieldDescription>
        {value.length === 6 ? `已輸入：${value}` : "請輸入簡訊中的 6 位數驗證碼"}
      </FieldDescription>
    </Field>
  );
}

function TextareaDemo() {
  return (
    <FieldGroup className="max-w-md">
      <Field>
        <FieldLabel htmlFor="gallery-textarea-note">備註</FieldLabel>
        <Textarea id="gallery-textarea-note" placeholder="輸入備註…" maxLength={200} />
        <FieldDescription>最多 200 字</FieldDescription>
      </Field>
      <Field data-invalid>
        <FieldLabel htmlFor="gallery-textarea-invalid">退件原因</FieldLabel>
        <Textarea id="gallery-textarea-invalid" aria-invalid />
        <FieldError>請填寫退件原因</FieldError>
      </Field>
      <Field data-disabled>
        <FieldLabel htmlFor="gallery-textarea-disabled">系統紀錄</FieldLabel>
        <Textarea id="gallery-textarea-disabled" defaultValue="此欄位不可編輯" disabled />
      </Field>
    </FieldGroup>
  );
}

function LabelDemo() {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id="gallery-label-terms" />
      <Label htmlFor="gallery-label-terms">我已閱讀並同意服務條款</Label>
    </div>
  );
}

function FieldDemo() {
  return (
    <FieldSet className="max-w-md">
      <FieldLegend>通知設定</FieldLegend>
      <FieldDescription>Field 系列負責排版：標籤、說明、錯誤與分組。</FieldDescription>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="gallery-field-name">顯示名稱</FieldLabel>
          <Input id="gallery-field-name" placeholder="王小明" />
          <FieldDescription>會顯示在留言與通知中</FieldDescription>
        </Field>
        <FieldSeparator />
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="gallery-field-email">Email 通知</FieldLabel>
            <FieldDescription>有新留言時寄信給我</FieldDescription>
          </FieldContent>
          <Switch id="gallery-field-email" defaultChecked />
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="gallery-field-digest" />
          <FieldLabel htmlFor="gallery-field-digest">每週摘要</FieldLabel>
        </Field>
      </FieldGroup>
    </FieldSet>
  );
}

function CheckboxDemo() {
  return (
    <FieldGroup className="max-w-sm">
      <Field orientation="horizontal">
        <Checkbox id="gallery-checkbox-agree" />
        <FieldLabel htmlFor="gallery-checkbox-agree">我同意服務條款</FieldLabel>
      </Field>
      <Field orientation="horizontal">
        <Checkbox id="gallery-checkbox-news" defaultChecked />
        <FieldContent>
          <FieldLabel htmlFor="gallery-checkbox-news">訂閱電子報</FieldLabel>
          <FieldDescription>每月一封，可隨時取消</FieldDescription>
        </FieldContent>
      </Field>
      <Field orientation="horizontal" data-disabled>
        <Checkbox id="gallery-checkbox-locked" defaultChecked disabled />
        <FieldLabel htmlFor="gallery-checkbox-locked">無法變更的選項</FieldLabel>
      </Field>
      <Field orientation="horizontal" data-invalid>
        <Checkbox id="gallery-checkbox-invalid" aria-invalid />
        <FieldLabel htmlFor="gallery-checkbox-invalid">必須勾選才能繼續</FieldLabel>
      </Field>
    </FieldGroup>
  );
}

function RadioGroupDemo() {
  return (
    <FieldSet className="max-w-sm">
      <FieldLegend variant="label">付款方式</FieldLegend>
      <RadioGroup defaultValue="card">
        <Field orientation="horizontal">
          <RadioGroupItem value="card" id="gallery-radio-card" />
          <FieldLabel htmlFor="gallery-radio-card">信用卡</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <RadioGroupItem value="atm" id="gallery-radio-atm" />
          <FieldLabel htmlFor="gallery-radio-atm">ATM 轉帳</FieldLabel>
        </Field>
        <Field orientation="horizontal" data-disabled>
          <RadioGroupItem value="cod" id="gallery-radio-cod" disabled />
          <FieldLabel htmlFor="gallery-radio-cod">貨到付款（暫停服務）</FieldLabel>
        </Field>
      </RadioGroup>
    </FieldSet>
  );
}

function SwitchDemo() {
  return (
    <FieldGroup className="max-w-sm">
      <Field orientation="horizontal">
        <Switch id="gallery-switch-dark" />
        <FieldLabel htmlFor="gallery-switch-dark">深色模式</FieldLabel>
      </Field>
      <Field orientation="horizontal">
        <Switch id="gallery-switch-mail" defaultChecked />
        <FieldLabel htmlFor="gallery-switch-mail">
          <Mail className="size-4" aria-hidden />
          Email 通知
        </FieldLabel>
      </Field>
      <Field orientation="horizontal" data-disabled>
        <Switch id="gallery-switch-disabled" disabled />
        <FieldLabel htmlFor="gallery-switch-disabled">停用</FieldLabel>
      </Field>
    </FieldGroup>
  );
}

function SliderDemo() {
  const [volume, setVolume] = useState([60]);
  const [range, setRange] = useState([200, 800]);
  return (
    <FieldGroup className="max-w-sm">
      <Field>
        <FieldLabel>音量：{volume[0]}</FieldLabel>
        <Slider value={volume} onValueChange={setVolume} max={100} step={1} aria-label="音量" />
      </Field>
      <Field>
        <FieldLabel>
          價格區間：NT$ {range[0]} – {range[1]}
        </FieldLabel>
        <Slider
          value={range}
          onValueChange={setRange}
          min={0}
          max={1000}
          step={50}
          aria-label="價格區間"
        />
      </Field>
      <Field data-disabled>
        <FieldLabel>停用</FieldLabel>
        <Slider defaultValue={[30]} disabled aria-label="停用的滑桿" />
      </Field>
    </FieldGroup>
  );
}

export const formDemos: Demo[] = [
  {
    name: "Button",
    description: "主要動作；loading 狀態用 Spinner + disabled，圖示加 data-icon",
    Component: ButtonDemo,
  },
  {
    name: "Button Group",
    description: "相關按鈕併成一組，也可夾文字或輸入框",
    Component: ButtonGroupDemo,
  },
  {
    name: "Input",
    description: "單行輸入；錯誤狀態用 Field data-invalid + aria-invalid",
    Component: InputDemo,
  },
  {
    name: "Input Group",
    description: "輸入框前後加圖示、文字或按鈕",
    Component: InputGroupDemo,
  },
  { name: "Input OTP", description: "一次性驗證碼輸入，支援貼上", Component: InputOtpDemo },
  { name: "Textarea", description: "多行文字輸入", Component: TextareaDemo },
  { name: "Label", description: "可點擊的表單標籤；表單內優先用 FieldLabel", Component: LabelDemo },
  {
    name: "Field",
    description:
      "表單排版：FieldSet / FieldGroup / Field / FieldLabel / FieldDescription / FieldError",
    Component: FieldDemo,
  },
  { name: "Checkbox", description: "多選或同意條款", Component: CheckboxDemo },
  {
    name: "Radio Group",
    description: "單選，選項少且需要全部看見時使用",
    Component: RadioGroupDemo,
  },
  { name: "Switch", description: "立即生效的開關設定", Component: SwitchDemo },
  { name: "Slider", description: "在範圍內選數值，支援單值與區間", Component: SliderDemo },
];
