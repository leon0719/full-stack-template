import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconnectDelay, type UseEventStreamOptions, useEventStream } from "./use-event-stream";

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly url: string;
  readonly withCredentials: boolean;
  closed = false;
  private listeners = new Map<string, ((event: MessageEvent | Event) => void)[]>();
  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent | Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data?: string) {
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  static get last() {
    return MockEventSource.instances[MockEventSource.instances.length - 1];
  }
}

function setup(options: UseEventStreamOptions) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook((props: UseEventStreamOptions) => useEventStream(props), {
    wrapper,
    initialProps: options,
  });
  return { ...hook, invalidate };
}

// 讓 connect() 裡 await 的 promise(取 token)跑完
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("reconnectDelay", () => {
  it("starts at 3s, doubles and caps at 60s", () => {
    const max = () => 1;
    expect([0, 1, 2, 3, 4, 5, 10].map((n) => reconnectDelay(n, { random: max }))).toEqual([
      3000, 6000, 12_000, 24_000, 48_000, 60_000, 60_000,
    ]);
  });

  it("applies jitter between half and the full ceiling", () => {
    expect(reconnectDelay(0, { random: () => 0 })).toBe(1500);
    expect(reconnectDelay(10, { random: () => 0 })).toBe(30_000);
  });
});

describe("useEventStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.spyOn(Math, "random").mockReturnValue(1);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("connects with params, reports open and invalidates mapped keys for named and typed events", async () => {
    const onMessage = vi.fn();
    const { result, invalidate } = setup({
      path: "/sse",
      params: { org: "1" },
      invalidate: { order_updated: [["orders"]], notice: [["notices"], ["badge"]] },
      onMessage,
      batchMs: 0,
    });
    await flush();
    const es = MockEventSource.last;
    expect(new URL(es.url).pathname).toBe("/sse");
    expect(new URL(es.url).searchParams.get("org")).toBe("1");
    expect(result.current).toBe("connecting");

    act(() => es.emit("open"));
    expect(result.current).toBe("open");

    // 具名事件(event: order_updated)
    act(() => es.emit("order_updated", '{"id":1}'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["orders"] });
    expect(onMessage).toHaveBeenCalledWith({ type: "order_updated", data: { id: 1 } });

    // 預設 message 事件,以 JSON 的 type 對應
    act(() => es.emit("message", '{"type":"notice","text":"hi"}'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["notices"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["badge"] });

    // 非 JSON 的 data 原樣交給 onMessage
    act(() => es.emit("message", "[DONE]"));
    expect(onMessage).toHaveBeenLastCalledWith({ type: "message", data: "[DONE]" });
  });

  it("batches invalidations within the window and dedupes keys", async () => {
    const { invalidate } = setup({ path: "/sse", invalidate: { tick: [["a"]] }, batchMs: 1000 });
    await flush();
    const es = MockEventSource.last;
    act(() => {
      es.emit("tick", "1");
      es.emit("tick", "2");
    });
    expect(invalidate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("puts a fresh stream token in the URL on every (re)connect", async () => {
    const getStreamToken = vi.fn().mockResolvedValueOnce("t1").mockResolvedValueOnce("t2");
    setup({ path: "/sse", getStreamToken, tokenParam: "st" });
    await flush();
    expect(new URL(MockEventSource.last.url).searchParams.get("st")).toBe("t1");

    act(() => MockEventSource.last.emit("error"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(getStreamToken).toHaveBeenCalledTimes(2);
    expect(new URL(MockEventSource.last.url).searchParams.get("st")).toBe("t2");
  });

  it("reconnects with exponential backoff, resets after open and refetches everything once reconnected", async () => {
    const { result, invalidate } = setup({
      path: "/sse",
      invalidate: { a: [["a"]], b: [["b"]] },
      batchMs: 0,
    });
    await flush();
    const first = MockEventSource.last;
    act(() => first.emit("error"));
    expect(first.closed).toBe(true);
    expect(result.current).toBe("reconnecting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(MockEventSource.instances).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    // 第二次失敗:等 6 秒
    act(() => MockEventSource.last.emit("error"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5999);
    });
    expect(MockEventSource.instances).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(MockEventSource.instances).toHaveLength(3);

    act(() => MockEventSource.last.emit("open"));
    expect(result.current).toBe("open");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["a"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["b"] });

    // 連上後歸零:下一次斷線又是 3 秒
    act(() => MockEventSource.last.emit("error"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(MockEventSource.instances).toHaveLength(4);
  });

  it("treats a missing heartbeat as a lost connection", async () => {
    setup({ path: "/sse", heartbeatTimeoutMs: 45_000 });
    await flush();
    const es = MockEventSource.last;
    act(() => es.emit("open"));
    act(() => vi.advanceTimersByTime(30_000));
    act(() => es.emit("message", '{"type":"heartbeat"}'));
    act(() => vi.advanceTimersByTime(30_000));
    expect(es.closed).toBe(false);
    act(() => vi.advanceTimersByTime(15_000));
    expect(es.closed).toBe(true);
  });

  it("closes the connection and stops reconnecting on unmount", async () => {
    const { unmount } = setup({ path: "/sse" });
    await flush();
    const es = MockEventSource.last;
    act(() => es.emit("error"));
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(MockEventSource.instances).toHaveLength(1);

    const second = setup({ path: "/sse" });
    await flush();
    second.unmount();
    expect(MockEventSource.last.closed).toBe(true);
  });

  it("does not connect while disabled and connects once enabled", async () => {
    const { result, rerender } = setup({ path: "/sse", enabled: false });
    await flush();
    expect(result.current).toBe("idle");
    expect(MockEventSource.instances).toHaveLength(0);
    rerender({ path: "/sse", enabled: true });
    await flush();
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("does not reconnect when only callbacks or the invalidate map change", async () => {
    const { rerender } = setup({ path: "/sse", invalidate: { a: [["a"]] }, onMessage: () => {} });
    await flush();
    rerender({ path: "/sse", invalidate: { a: [["a"], ["b"]] }, onMessage: () => {} });
    await flush();
    expect(MockEventSource.instances).toHaveLength(1);
  });
});
