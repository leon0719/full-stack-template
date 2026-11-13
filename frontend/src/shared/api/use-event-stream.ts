import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { resolveUrl } from "./client";

export type EventStreamStatus = "idle" | "connecting" | "open" | "reconnecting";

export interface EventStreamMessage {
  /** SSE 的 `event:` 名稱;預設 message 事件若 data 是帶字串 `type` 的 JSON,則取那個 type */
  type: string;
  /** data 是 JSON 就是解析後的值,否則是原始字串 */
  data: unknown;
}

export interface UseEventStreamOptions {
  /** SSE 端點,與 apiGet 一樣相對於 VITE_API_BASE_URL,例:"/api/v1/realtime/sse" */
  path: string;
  /** 事件名稱 → 收到時要 invalidate 的 query keys(前綴比對,同 invalidateQueries) */
  invalidate?: Record<string, readonly QueryKey[]>;
  /** 除了 invalidate 的 key 以外,還要監聽的具名事件(只交給 onMessage) */
  events?: readonly string[];
  onMessage?: (message: EventStreamMessage) => void;
  /**
   * 取得短效 stream token。EventSource 不能帶 Authorization header,token 只能放 URL,
   * 而 URL 會留在瀏覽器歷史與 proxy log,所以不要放長效 access token:
   * 由後端發一顆只能用來開 stream、效期數十秒的 token(例:POST /auth/stream-token)。
   * 每次(重新)連線前都會呼叫一次。
   */
  getStreamToken?: () => Promise<string>;
  /** token 的 query 參數名稱,預設 "token" */
  tokenParam?: string;
  params?: Record<string, string>;
  /** false 時不連線(例如尚未登入),預設 true */
  enabled?: boolean;
  /** 後端有送心跳時設定:這麼久沒收到任何事件就當作斷線重連(睡眠、proxy 默默斷線時 EventSource 不會報錯) */
  heartbeatTimeoutMs?: number;
  /** 這段時間內要 invalidate 的 key 合併成一次,避免一波推播觸發一堆重抓;預設 300ms,0 為立即 */
  batchMs?: number;
  /** 斷線後重新連上時,把 invalidate 裡所有 key 重抓一次(斷線期間漏掉的推播沒辦法補),預設 true */
  invalidateOnReconnect?: boolean;
  /** 用 cookie 認證的跨網域 SSE 才需要 */
  withCredentials?: boolean;
}

const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60_000;

/**
 * 第 attempt 次(從 0 起算)重連前要等多久:3 秒起跳、每次加倍、上限 60 秒,
 * 再乘上 0.5–1 的隨機值(jitter),避免後端重啟時所有分頁同一秒一起湧進來。
 */
export function reconnectDelay(
  attempt: number,
  { baseMs = RECONNECT_BASE_MS, maxMs = RECONNECT_MAX_MS, random = Math.random } = {},
): number {
  const ceiling = Math.min(baseMs * 2 ** attempt, maxMs);
  return ceiling * (0.5 + random() * 0.5);
}

function parseData(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * 訂閱後端 SSE,收到事件就 invalidate 對應的 TanStack Query 快取,畫面不用等輪詢或手動重新整理。
 *
 * - 斷線(含後端正常關閉連線,例如部署)一律手動重連,指數退避 + jitter(見 reconnectDelay),
 *   連上後歸零;每次重連都重新取一顆 stream token。
 * - 元件卸載或 enabled 變 false 時關閉連線、清掉所有計時器。
 * - 回傳連線狀態,可在畫面顯示「即時更新中斷」。
 *
 * ```ts
 * const status = useEventStream({
 *   path: "/api/v1/realtime/sse",
 *   invalidate: { order_updated: [["orders"]], notification: [["notifications"]] },
 *   getStreamToken: async () => (await apiPost<{ token: string }>("/auth/stream-token")).token,
 *   enabled: isAuthenticated,
 * });
 * ```
 */
export function useEventStream(options: UseEventStreamOptions): EventStreamStatus {
  const queryClient = useQueryClient();
  const enabled = options.enabled ?? true;
  const [status, setStatus] = useState<EventStreamStatus>(enabled ? "connecting" : "idle");

  // callback 與 invalidate 對照表常是 inline 物件:放 ref 讀最新值,不因此重連
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const { path, tokenParam = "token", withCredentials = false } = options;
  const eventNames = [
    ...new Set([...Object.keys(options.invalidate ?? {}), ...(options.events ?? [])]),
  ]
    .filter((name) => name !== "message")
    .sort()
    .join(",");
  const paramsKey = JSON.stringify(options.params ?? {});

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }

    let source: EventSource | null = null;
    let stopped = false;
    let attempt = 0;
    let lost = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let batchTimer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const pending = new Map<string, QueryKey>();

    const flush = () => {
      batchTimer = undefined;
      for (const queryKey of pending.values()) queryClient.invalidateQueries({ queryKey });
      pending.clear();
    };

    const scheduleInvalidate = (keys: readonly QueryKey[]) => {
      for (const key of keys) pending.set(JSON.stringify(key), key);
      const batchMs = latest.current.batchMs ?? 300;
      if (batchMs <= 0) flush();
      else batchTimer ??= setTimeout(flush, batchMs);
    };

    const scheduleReconnect = () => {
      if (stopped) return;
      clearTimeout(watchdog);
      source?.close();
      source = null;
      lost = true;
      setStatus("reconnecting");
      reconnectTimer = setTimeout(() => void connect(), reconnectDelay(attempt++));
    };

    const resetWatchdog = () => {
      const timeout = latest.current.heartbeatTimeoutMs;
      if (!timeout) return;
      clearTimeout(watchdog);
      watchdog = setTimeout(scheduleReconnect, timeout);
    };

    const handle = (eventName: string, raw: string) => {
      resetWatchdog();
      const data = parseData(raw);
      const type =
        eventName === "message" &&
        data !== null &&
        typeof data === "object" &&
        typeof (data as { type?: unknown }).type === "string"
          ? (data as { type: string }).type
          : eventName;
      const keys = latest.current.invalidate?.[type];
      if (keys?.length) scheduleInvalidate(keys);
      latest.current.onMessage?.({ type, data });
    };

    const connect = async () => {
      if (stopped) return;
      const url = new URL(resolveUrl(path), location.origin);
      for (const [key, value] of Object.entries(JSON.parse(paramsKey) as Record<string, string>)) {
        url.searchParams.set(key, value);
      }
      const getToken = latest.current.getStreamToken;
      if (getToken) {
        try {
          url.searchParams.set(tokenParam, await getToken());
        } catch {
          scheduleReconnect();
          return;
        }
        if (stopped) return;
      }

      const es = new EventSource(url.toString(), { withCredentials });
      source = es;
      es.addEventListener("open", () => {
        attempt = 0;
        resetWatchdog();
        if (lost) {
          lost = false;
          if (latest.current.invalidateOnReconnect ?? true) {
            scheduleInvalidate(Object.values(latest.current.invalidate ?? {}).flat());
          }
        }
        setStatus("open");
      });
      es.addEventListener("message", (event) => handle("message", event.data));
      for (const name of eventNames ? eventNames.split(",") : []) {
        es.addEventListener(name, (event) => handle(name, (event as MessageEvent).data));
      }
      // 不靠 EventSource 自己重連:它會重用 URL 裡已過期的 stream token,
      // 後端正常關閉連線時也不一定會重試,統一關掉走退避重連
      es.addEventListener("error", scheduleReconnect);
    };

    setStatus("connecting");
    void connect();

    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      clearTimeout(batchTimer);
      clearTimeout(watchdog);
      source?.close();
    };
  }, [queryClient, enabled, path, paramsKey, tokenParam, withCredentials, eventNames]);

  return status;
}
