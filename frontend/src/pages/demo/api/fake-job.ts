import type { Job, JobId } from "@/shared/api";

// 示範用的假後端:不打 API,依經過時間算進度,讓 demo 頁不需要後端也能看到 useJobPolling 的效果。
// 真實專案直接用 useJobPolling(jobId) 的預設(GET /jobs/{id}、POST /jobs/{id}/cancel)。
const DURATION_MS = 8000;
const jobs = new Map<JobId, { startedAt: number; cancelledAt: number | null }>();
let seq = 0;

export function startFakeJob(): string {
  // 不用 crypto.randomUUID():非 HTTPS 的區網 IP(手機實機測試)沒有它
  const id = `demo-${++seq}`;
  jobs.set(id, { startedAt: Date.now(), cancelledAt: null });
  return id;
}

export async function fetchFakeJob(id: JobId): Promise<Job<{ rows: number }>> {
  const entry = jobs.get(id);
  if (!entry) throw new Error(`unknown job ${id}`);
  const end = entry.cancelledAt ?? Date.now();
  const elapsed = end - entry.startedAt;
  const progress = Math.min(100, Math.round((elapsed / DURATION_MS) * 100));
  if (entry.cancelledAt !== null)
    return { id, status: "cancelled", progress, result: null, error: null };
  if (elapsed < 1000) return { id, status: "pending", progress: null, result: null, error: null };
  if (progress < 100) return { id, status: "running", progress, result: null, error: null };
  return { id, status: "succeeded", progress: 100, result: { rows: 128 }, error: null };
}

export async function cancelFakeJob(id: JobId): Promise<void> {
  const entry = jobs.get(id);
  if (entry && entry.cancelledAt === null) entry.cancelledAt = Date.now();
}
