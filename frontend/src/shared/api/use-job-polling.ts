import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { apiGet, apiPost } from "./client";

/** 任務 ID;後端 PK 多為整數,也接受字串(UUID) */
export type JobId = string | number;

/** 後端長任務狀態;值須與後端一致(literal union,不用 TS enum) */
export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

/** `GET /jobs/{id}` 的回應(BaseResponse 的 data) */
export interface Job<TResult = unknown> {
  /** 任務 ID */
  id: JobId;
  /** 目前狀態;succeeded / failed / cancelled 為終態 */
  status: JobStatus;
  /** 進度 0–100;後端無法估算時為 null */
  progress: number | null;
  /** 成功時的結果(例如匯入筆數、下載路徑);其餘狀態為 null */
  result: TResult | null;
  /** 失敗原因的穩定錯誤碼(可當 i18n key);沒有失敗時為 null */
  error: string | null;
}

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["succeeded", "failed", "cancelled"];

export function isTerminalJobStatus(status: JobStatus | undefined): boolean {
  return status !== undefined && TERMINAL_JOB_STATUSES.includes(status);
}

export interface UseJobPollingOptions<TResult> {
  /** 輪詢間隔,預設 2000ms */
  intervalMs?: number;
  /** 預設 "/jobs" → GET /jobs/{id}、POST /jobs/{id}/cancel */
  basePath?: string;
  /** 端點不是上述慣例時覆寫 */
  fetchJob?: (jobId: JobId, signal: AbortSignal) => Promise<Job<TResult>>;
  cancelJob?: (jobId: JobId) => Promise<unknown>;
  /** 進入終態時呼叫一次(例如 toast、invalidate 列表) */
  onSettled?: (job: Job<TResult>) => void;
}

export function jobQueryKey(jobId: JobId | null) {
  return ["jobs", jobId] as const;
}

/**
 * 輪詢後端長任務直到終態(succeeded / failed / cancelled)就停止,並提供 cancel。
 * jobId 為 null 時不輪詢(任務還沒建立)。查詢失敗(含 retry 用完)也會停止輪詢,
 * 由畫面顯示 error 並用 `refetch()` 恢復。
 *
 * ```ts
 * const start = useMutation({ mutationFn: () => apiPost<{ id: JobId }>("/imports", form) });
 * const { job, isTerminal, cancel } = useJobPolling<ImportResult>(start.data?.id ?? null, {
 *   onSettled: (job) => job.status === "succeeded" && queryClient.invalidateQueries({ queryKey: ["orders"] }),
 * });
 * ```
 */
export function useJobPolling<TResult = unknown>(
  jobId: JobId | null,
  options: UseJobPollingOptions<TResult> = {},
) {
  const { intervalMs = 2000, basePath = "/jobs", fetchJob, cancelJob, onSettled } = options;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: jobQueryKey(jobId),
    queryFn: ({ signal }) =>
      fetchJob
        ? fetchJob(jobId as JobId, signal)
        : apiGet<Job<TResult>>(`${basePath}/${encodeURIComponent(String(jobId))}`, { signal }),
    enabled: jobId !== null,
    // 任務狀態一定要拿最新的,不吃全域 staleTime
    staleTime: 0,
    refetchInterval: (q) => {
      if (q.state.status === "error") return false;
      return isTerminalJobStatus(q.state.data?.status) ? false : intervalMs;
    },
  });

  const job = query.data ?? null;
  const isTerminal = isTerminalJobStatus(job?.status);

  // 每個 jobId 只通知一次終態
  const settledFor = useRef<JobId | null>(null);
  useEffect(() => {
    if (!job || !isTerminal || settledFor.current === job.id) return;
    settledFor.current = job.id;
    onSettled?.(job);
  }, [job, isTerminal, onSettled]);

  const cancelMutation = useMutation({
    mutationFn: (id: JobId) =>
      cancelJob ? cancelJob(id) : apiPost(`${basePath}/${encodeURIComponent(String(id))}/cancel`),
    // 取消是非同步的(後端可能還在收尾):立刻重抓一次,之後照輪詢等它進入 cancelled
    onSettled: (_data, _error, id) => queryClient.invalidateQueries({ queryKey: jobQueryKey(id) }),
  });

  return {
    job,
    error: query.error,
    /** 有 jobId、還沒到終態、也沒有出錯 */
    isPolling: jobId !== null && !isTerminal && query.status !== "error",
    isTerminal,
    refetch: query.refetch,
    cancel: async () => {
      if (jobId === null || isTerminal) return;
      await cancelMutation.mutateAsync(jobId);
    },
    isCancelling: cancelMutation.isPending,
    cancelError: cancelMutation.error,
  };
}
