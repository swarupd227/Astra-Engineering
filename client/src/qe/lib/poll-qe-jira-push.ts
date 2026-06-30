import type { AsyncJobStatusResponse, PollAsyncJobOptions } from "../../lib/async-job-poller";

/**
 * Poll QE Jira bulk-push jobs via `/api/jira/push-test-cases/status/:jobId`.
 * Does not use `/api/jobs/...` (that route requires SSO Bearer auth; QE uses cookie login).
 */
export async function pollQeJiraPushJob<TResult = unknown>(
  jobId: string,
  options: PollAsyncJobOptions = {},
): Promise<TResult> {
  const intervalMs = options.intervalMs ?? 2000;
  const maxDurationMs = options.maxDurationMs ?? 4 * 60 * 60 * 1000;
  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > maxDurationMs) {
      throw new Error("Timed out waiting for Jira push. Please refresh and try again.");
    }

    const resp = await fetch(
      `/api/jira/push-test-cases/status/${encodeURIComponent(jobId)}`,
      { method: "GET", credentials: "include" },
    );

    if (!resp.ok) {
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 408 && resp.status !== 429) {
        const errBody = await resp.json().catch(() => ({} as { error?: string; message?: string }));
        throw new Error(
          errBody?.error || errBody?.message || `Failed to fetch push status (HTTP ${resp.status})`,
        );
      }
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }

    const data = (await resp.json().catch(() => ({}))) as AsyncJobStatusResponse<TResult>;

    if (options.onProgress && data?.progress?.message) {
      options.onProgress(data.progress.message, data.progress.percent);
    } else if (options.onProgress && data?.step) {
      options.onProgress(data.step);
    }

    if (data?.status === "completed") {
      return data.result as TResult;
    }
    if (data?.status === "failed") {
      throw new Error(data?.error || "Jira push failed on the server.");
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
