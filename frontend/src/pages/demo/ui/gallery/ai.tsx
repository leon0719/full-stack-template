import {
  BotIcon,
  FileSearchIcon,
  FileTextIcon,
  ImageIcon,
  SparklesIcon,
  TerminalIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import type { FormEvent } from "react";
import { useHighlightedCode } from "@/shared/lib";

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  Bubble,
  BubbleContent,
  BubbleGroup,
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
  Marker,
  MarkerContent,
  MarkerIcon,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
  Spinner,
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
  toast,
} from "@/shared/ui";
import type { Demo } from "./types";

// 假對話資料,不打任何 API
const SOURCE = `export function formatPrice(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
  }).format(value);
}`;

function MessageDemo() {
  return (
    <div className="flex flex-col gap-4">
      <Message align="end">
        <MessageAvatar>
          <UserIcon className="size-4" />
        </MessageAvatar>
        <MessageContent>
          <Bubble>
            <BubbleContent>金額要怎麼格式化成新台幣?</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
      <Message>
        <MessageAvatar>
          <BotIcon className="size-4" />
        </MessageAvatar>
        <MessageContent>
          <MessageHeader>助理</MessageHeader>
          <Bubble variant="muted">
            <BubbleContent>用 Intl.NumberFormat,currency 設成 TWD 即可。</BubbleContent>
          </Bubble>
          <MessageFooter>剛剛</MessageFooter>
        </MessageContent>
      </Message>
    </div>
  );
}

function BubbleDemo() {
  return (
    <BubbleGroup>
      <Bubble>
        <BubbleContent>default</BubbleContent>
      </Bubble>
      <Bubble variant="secondary">
        <BubbleContent>secondary</BubbleContent>
      </Bubble>
      <Bubble variant="muted" align="end">
        <BubbleContent>muted(靠右)</BubbleContent>
      </Bubble>
      <Bubble variant="tinted">
        <BubbleContent>tinted</BubbleContent>
      </Bubble>
      <Bubble variant="outline">
        <BubbleContent>outline</BubbleContent>
      </Bubble>
      <Bubble variant="destructive">
        <BubbleContent>destructive:回覆產生失敗</BubbleContent>
      </Bubble>
    </BubbleGroup>
  );
}

const SCROLL_MESSAGES = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  mine: i % 2 === 0,
  text: i % 2 === 0 ? `第 ${i / 2 + 1} 個問題` : `第 ${(i + 1) / 2} 個回答`,
}));

function MessageScrollerDemo() {
  return (
    // Root 要包在 Provider 裡(Provider 管捲動狀態,讓外部也能用 useMessageScroller 控制)
    <MessageScrollerProvider>
      <MessageScroller className="h-64 rounded-lg border">
        <MessageScrollerViewport className="p-3">
          <MessageScrollerContent>
            {SCROLL_MESSAGES.map((m) => (
              <MessageScrollerItem key={m.id}>
                <Message align={m.mine ? "end" : "start"}>
                  <MessageContent>
                    <Bubble variant={m.mine ? "default" : "muted"}>
                      <BubbleContent>{m.text}</BubbleContent>
                    </Bubble>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function AttachmentDemo() {
  return (
    <AttachmentGroup>
      <Attachment>
        <AttachmentMedia>
          <FileTextIcon />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>報價單.pdf</AttachmentTitle>
          <AttachmentDescription>PDF · 2.4 MB</AttachmentDescription>
        </AttachmentContent>
        <AttachmentActions>
          <AttachmentAction aria-label="移除 報價單.pdf">
            <XIcon />
          </AttachmentAction>
        </AttachmentActions>
      </Attachment>
      <Attachment>
        <AttachmentMedia>
          <ImageIcon />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>螢幕截圖.png</AttachmentTitle>
          <AttachmentDescription>PNG · 820 KB</AttachmentDescription>
        </AttachmentContent>
      </Attachment>
      <Attachment>
        <AttachmentMedia>
          <Spinner label="" />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>客戶名單.xlsx</AttachmentTitle>
          <AttachmentDescription>上傳中…</AttachmentDescription>
        </AttachmentContent>
      </Attachment>
    </AttachmentGroup>
  );
}

function MarkerDemo() {
  return (
    <div className="flex flex-col gap-3">
      <Marker role="status">
        <MarkerIcon>
          <Spinner label="" />
        </MarkerIcon>
        <MarkerContent className="shimmer">思考中…</MarkerContent>
      </Marker>
      <Marker>
        <MarkerIcon>
          <SparklesIcon />
        </MarkerIcon>
        <MarkerContent>已改用較快的模型回答</MarkerContent>
      </Marker>
      <Marker className="justify-center">
        <MarkerContent>
          <strong className="font-medium">王小明</strong> 加入了對話
        </MarkerContent>
      </Marker>
    </div>
  );
}

function CodeBlockDemo() {
  // shiki 的語言與主題都是動態 import;載入前(或在測試環境失敗時)先顯示純文字
  const lines = useHighlightedCode(SOURCE, "ts");
  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>
          <TerminalIcon />
          format-price.ts
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={SOURCE} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent lineNumbers>
        {lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 行號就是行的身分,內容不會重排
          <CodeBlockLine key={index} variant={index === 3 ? "highlighted" : "default"}>
            {line}
          </CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

const QUESTIONS = [
  { name: "tone", required: true, choices: [{ value: "formal" }, { value: "casual" }] },
  { name: "length", choices: [{ value: "short" }, { value: "detailed" }] },
] as const;

function onQuestionnaireSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  toast(`語氣：${data.get("tone") ?? "未選"}，長度：${data.get("length") ?? "未選"}`);
}

function QuestionnaireDemo() {
  return (
    <Questionnaire
      className="max-w-lg"
      defaultItem="tone"
      items={QUESTIONS}
      shortcuts="numbers"
      onSubmit={onQuestionnaireSubmit}
    >
      <QuestionnaireProgress />
      <QuestionnaireItem name="tone" required>
        <QuestionnaireTitle>回覆要用什麼語氣?</QuestionnaireTitle>
        <QuestionnaireDescription>會套用到之後的每一則回覆。</QuestionnaireDescription>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="formal">
            <span className="font-medium">正式</span>
            <QuestionnaireChoiceDescription>適合寄給客戶的信件</QuestionnaireChoiceDescription>
          </QuestionnaireChoice>
          <QuestionnaireChoice value="casual">
            <span className="font-medium">輕鬆</span>
            <QuestionnaireChoiceDescription>適合團隊內部溝通</QuestionnaireChoiceDescription>
          </QuestionnaireChoice>
        </QuestionnaireChoices>
        <QuestionnaireError />
      </QuestionnaireItem>
      <QuestionnaireItem name="length">
        <QuestionnaireTitle>回覆長度</QuestionnaireTitle>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="short">簡短</QuestionnaireChoice>
          <QuestionnaireChoice value="detailed">詳細</QuestionnaireChoice>
        </QuestionnaireChoices>
      </QuestionnaireItem>
      <QuestionnaireActions>
        <QuestionnairePrevious />
        <QuestionnaireNext>下一題</QuestionnaireNext>
        <QuestionnaireSubmit>完成</QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  );
}

function TraceDemo() {
  return (
    <Trace className="max-w-md">
      <TraceLine>
        <TraceIcon>
          <FileSearchIcon />
        </TraceIcon>
        <TraceTitle>搜尋了 12 個檔案</TraceTitle>
      </TraceLine>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <TerminalIcon />
            </TraceIcon>
            <TraceTitle>執行 bun run test</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <CodeBlock size="sm">
            <CodeBlockContent wrap>Tests 185 passed (185)</CodeBlockContent>
          </CodeBlock>
        </TraceCollapsibleContent>
      </TraceCollapsible>
      <TraceLine status="error">
        <TraceIcon>
          <XIcon />
        </TraceIcon>
        <TraceTitle>讀取 .env 被拒絕</TraceTitle>
      </TraceLine>
      <TraceLine status="running">
        <TraceIcon>
          <Spinner label="" />
        </TraceIcon>
        <TraceTitle>撰寫回覆</TraceTitle>
      </TraceLine>
      <TraceLine status="pending">
        <TraceIcon>
          <SparklesIcon />
        </TraceIcon>
        <TraceTitle>整理摘要</TraceTitle>
      </TraceLine>
    </Trace>
  );
}

export const aiDemos: Demo[] = [
  { name: "Message", description: "一則對話訊息：頭像、標題、內容、頁尾", Component: MessageDemo },
  { name: "Bubble", description: "訊息泡泡的各種樣式", Component: BubbleDemo },
  {
    name: "Message Scroller",
    description: "對話捲動區：新訊息自動捲到底，往上捲時出現回到底部按鈕",
    Component: MessageScrollerDemo,
  },
  { name: "Attachment", description: "訊息附件：檔案、圖片、上傳中", Component: AttachmentDemo },
  { name: "Marker", description: "對話中的狀態標記(思考中、系統事件)", Component: MarkerDemo },
  {
    name: "Code Block",
    description: "程式碼區塊；useHighlightedCode 以 shiki 動態載入語法高亮",
    Component: CodeBlockDemo,
  },
  {
    name: "Questionnaire",
    description: "逐題作答的問卷，支援數字鍵快捷鍵與必填檢查",
    Component: QuestionnaireDemo,
  },
  {
    name: "Trace",
    description: "助理的工作步驟：執行中、錯誤、待處理、可展開細節",
    Component: TraceDemo,
  },
];
