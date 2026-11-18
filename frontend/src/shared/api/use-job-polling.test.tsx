import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCsrfToken } from "./client";
import { type Job, type UseJobPollingOptions, useJobPolling } from "./use-job-polling";

function job(status: Job["status"], progress: number | null = null): Job<{ rows: number }> {
  return {
    id: "j1",
    status,
    progress,
    result: status === "succeeded" ? { rows: 3 } : null,
    error: status === "failed" ? "import_failed" : null,
  };
}

function setup(jobId: string | null, options: UseJobPollingOptions<{ rows: number }> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook((id: string | null) => useJobPolling(id, options), {
    wrapper,
    initialProps: jobId,
  });
}

const ok = (body: unknown) =>
  new Response(JSON.stringify({ data: body, error: null }), { status: 200 });

describe("useJobPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetCsrfToken();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does nothing without a job id", () => {
    const fetchJob = vi.fn();
    const { result } = setup(null, { fetchJob });
    expect(fetchJob).not.toHaveBeenCalled();
    expect(result.current.isPolling).toBe(false);
    expect(result.current.job).toBeNull();
  });

  it("polls GET /jobs/{id} at the interval and stops at a terminal status", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok(job("pending")))
      .mockResolvedValueOnce(ok(job("running", 50)))
      .mockResolvedValueOnce(ok(job("succeeded", 100)));
    const onSettled = vi.fn();
    const { result } = setup("j1", { intervalMs: 1000, onSettled });

    await waitFor(() => expect(result.current.job?.status).toBe("pending"));
    expect(fetchSpy.mock.calls[0][0]).toBe("/jobs/j1");
    expect(result.current.isPolling).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await waitFor(() => expect(result.current.job?.progress).toBe(50));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await waitFor(() => expect(result.current.isTerminal).toBe(true));
    expect(result.current.job?.result).toEqual({ rows: 3 });
    expect(result.current.isPolling).toBe(false);
    expect(onSettled).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("cancels through POST /jobs/{id}/cancel and refetches right away", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok(job("running", 10)))
      .mockResolvedValueOnce(ok({ csrf_token: "csrf-1" })) // POST 前先取 CSRF token
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok(job("cancelled", 10)));
    const { result } = setup("j1", { intervalMs: 60_000 });
    await waitFor(() => expect(result.current.job?.status).toBe("running"));

    await act(async () => {
      await result.current.cancel();
    });
    const [url, init] = fetchSpy.mock.calls[2];
    expect(url).toBe("/jobs/j1/cancel");
    expect((init as RequestInit).method).toBe("POST");
    await waitFor(() => expect(result.current.job?.status).toBe("cancelled"));
    expect(result.current.isTerminal).toBe(true);
  });

  it("stops polling and exposes the error when the request fails", async () => {
    const fetchJob = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = setup("j1", { fetchJob, intervalMs: 1000 });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.isPolling).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchJob).toHaveBeenCalledTimes(1);
  });

  it("uses custom fetch/cancel functions when given", async () => {
    const fetchJob = vi.fn().mockResolvedValue(job("running", 1));
    const cancelJob = vi.fn().mockResolvedValue(undefined);
    const { result } = setup("j1", { fetchJob, cancelJob });
    await waitFor(() => expect(result.current.job).not.toBeNull());
    expect(fetchJob).toHaveBeenCalledWith("j1", expect.any(AbortSignal));
    await act(async () => {
      await result.current.cancel();
    });
    expect(cancelJob).toHaveBeenCalledWith("j1");
  });
});
