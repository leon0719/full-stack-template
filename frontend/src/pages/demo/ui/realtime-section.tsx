import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type JobStatus, useEventStream, useJobPolling } from "@/shared/api";
import { formatDateTime, formatRelativeTime } from "@/shared/lib";
import { Badge, Button, toast } from "@/shared/ui";
import { cancelFakeJob, fetchFakeJob, startFakeJob } from "../api/fake-job";

const STATUS_TONE: Record<JobStatus, "secondary" | "info" | "success" | "destructive" | "warning"> =
  {
    pending: "secondary",
    running: "info",
    succeeded: "success",
    failed: "destructive",
    cancelled: "warning",
  };

// 本 repo 的後端沒有 SSE 端點(上游模板的 apps/realtime 與 POST /auth/stream-token 都沒同步過來)。
// 預設不連線;按下「連線 SSE」只會看到斷線後的退避重連。要真的用:後端補 SSE + stream token 端點,
// 再把下面的 getStreamToken 打開(見 docs/platform.md 的 useEventStream)。
const STREAM_PATH = "/realtime/sse";

function JobDemo() {
  const { t } = useTranslation();
  const [jobId, setJobId] = useState<string | null>(null);
  // 真實專案:useJobPolling(jobId) 即可(GET /jobs/{id}、POST /jobs/{id}/cancel);這裡換成假後端
  const { job, isPolling, cancel, isCancelling } = useJobPolling(jobId, {
    intervalMs: 500,
    fetchJob: fetchFakeJob,
    cancelJob: cancelFakeJob,
    onSettled: (settled) => toast(t(`common.job.status.${settled.status}`)),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setJobId(startFakeJob())} disabled={isPolling}>
          {t("pages.demo.realtime.startJob")}
        </Button>
        {isPolling && (
          <Button variant="outline" onClick={() => cancel()} disabled={isCancelling}>
            {t("common.job.cancel")}
          </Button>
        )}
        {job && (
          <Badge variant={STATUS_TONE[job.status]}>{t(`common.job.status.${job.status}`)}</Badge>
        )}
      </div>
      {job && (
        <div className="flex items-center gap-3">
          <progress
            className="h-2 w-full max-w-sm"
            max={100}
            value={job.progress ?? undefined}
            aria-label={t("pages.demo.realtime.progress", { percent: job.progress ?? 0 })}
          />
          <span className="text-sm tabular-nums text-muted-foreground">
            {t("pages.demo.realtime.progress", { percent: job.progress ?? 0 })}
          </span>
        </div>
      )}
    </div>
  );
}

function StreamDemo() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const status = useEventStream({
    path: STREAM_PATH,
    enabled,
    // 事件名稱 → 要重抓的 query key;例:後端推 {"type":"repo_updated"} 就重抓 Repo 區塊
    invalidate: { repo_updated: [["repo"]] },
    onMessage: () => setLastEventAt(new Date()),
    // 後端補上 stream token 端點後:getStreamToken: async () => (await apiPost<{ token: string }>("/auth/stream-token")).token,
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => setEnabled((v) => !v)}>
          {enabled
            ? t("pages.demo.realtime.streamToggleOff")
            : t("pages.demo.realtime.streamToggleOn")}
        </Button>
        <Badge
          variant={
            status === "open" ? "success" : status === "reconnecting" ? "warning" : "secondary"
          }
        >
          {t(`pages.demo.realtime.streamStatus.${status}`)}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("pages.demo.realtime.streamHint", { path: STREAM_PATH })}
      </p>
      {lastEventAt && (
        <p className="text-sm text-muted-foreground">
          {t("pages.demo.realtime.updatedAt", {
            time: formatDateTime(lastEventAt, { withSeconds: true }),
            relative: formatRelativeTime(lastEventAt),
          })}
        </p>
      )}
    </div>
  );
}

export function RealtimeSection() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-6">
      <h3 className="text-lg font-semibold">{t("pages.demo.realtime.title")}</h3>
      <JobDemo />
      <StreamDemo />
    </section>
  );
}
