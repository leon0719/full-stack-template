import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoPage } from "@/pages/demo";
import { useGreetingStore } from "./model/use-greeting-store";
import { aiDemos } from "./ui/gallery/ai";
import { displayDemos } from "./ui/gallery/display";
import { formDemos } from "./ui/gallery/forms";
import { layoutDemos } from "./ui/gallery/layout";
import { overlayDemos } from "./ui/gallery/overlays";
import { pickerDemos } from "./ui/gallery/pickers";

afterEach(() => vi.restoreAllMocks());

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const stubFetchOk = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ full_name: "facebook/react", stargazers_count: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );

describe("DemoPage", () => {
  beforeEach(() => {
    useGreetingStore.setState({ name: "" });
  });

  it("shows loading then the fetched repo name", async () => {
    stubFetchOk();
    renderWithClient(<DemoPage />);
    expect(screen.getByText(/載入中/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/facebook\/react/)).toBeInTheDocument());
  });

  it("shows the error state when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    renderWithClient(<DemoPage />);
    await waitFor(() => expect(screen.getByText(/載入失敗/)).toBeInTheDocument());
  });

  it("shows a validation error when name is too short", async () => {
    stubFetchOk();
    const user = userEvent.setup();
    renderWithClient(<DemoPage />);
    await user.type(screen.getByLabelText(/你的名字/), "A");
    await user.click(screen.getByRole("button", { name: /送出/i }));
    await waitFor(() => expect(screen.getByText(/至少 2 個字/)).toBeInTheDocument());
  });

  it("displays greeting after valid submission", async () => {
    stubFetchOk();
    const user = userEvent.setup();
    renderWithClient(<DemoPage />);
    await user.type(screen.getByLabelText(/你的名字/), "Ada");
    await user.click(screen.getByRole("button", { name: /送出/i }));
    await waitFor(() => expect(screen.getByText(/Hello, Ada/)).toBeInTheDocument());
  });

  it("shows every gallery component and the integration demos without opening an SSE connection", () => {
    stubFetchOk();
    const eventSource = vi.fn();
    vi.stubGlobal("EventSource", eventSource);
    renderWithClient(<DemoPage />);
    expect(screen.getByRole("heading", { level: 1, name: "元件展示" })).toBeInTheDocument();
    const demos = [
      ...formDemos,
      ...pickerDemos,
      ...overlayDemos,
      ...layoutDemos,
      ...displayDemos,
      ...aiDemos,
    ];
    // shadcn 全部 66 個元件 + 本模板自製的 FileDropzone
    expect(demos).toHaveLength(67);
    for (const { name } of demos) {
      expect(screen.getByRole("heading", { level: 3, name })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: "整合範例" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "上傳與檔案" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "長任務與即時更新" })).toBeInTheDocument();
    expect(screen.getByText("未連線")).toBeInTheDocument();
    expect(eventSource).not.toHaveBeenCalled();
  });

  it("runs the simulated job through useJobPolling", async () => {
    stubFetchOk();
    const user = userEvent.setup();
    renderWithClient(<DemoPage />);
    await user.click(screen.getByRole("button", { name: "開始模擬任務" }));
    expect(await screen.findByRole("button", { name: "取消任務" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /^進度 \d+%$/ })).toBeInTheDocument();
  });
});
