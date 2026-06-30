/**
 * Client-side helper for polling the universal async-job status endpoint.
 *
 * The backend (see `server/lib/async-job-manager.ts`) accepts long-running
 * operations as background jobs and exposes status at
 * `GET /api/jobs/:namespace/status/:jobId`. This helper polls that endpoint
 * until the job reports `completed` or `failed`.
 *
 * Used to bypass AWS API Gateway's ~29 second request timeout (which
 * surfaces as a 503 Service Unavailable with `content-length: 33`) for
 * multi-file Git pushes, bulk Jira/ADO/Confluence pushes, etc.
 */

import { getApiUrl } from "./api-config";

export interface AsyncJobStatusResponse<TResult = unknown> {
  jobId: string;
  namespace: string;
  status: "queued" | "processing" | "completed" | "failed";
  step?: string;
  progress?: { percent: number; message: string; updatedAt: string };
  result?: TResult;
  error?: string;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PollAsyncJobOptions {
  intervalMs?: number;
  maxDurationMs?: number;
  onProgress?: (message: string, percent?: number) => void;
}

/**
 * Poll an async job until it reaches a terminal state.
 *
 * @returns the `result` field of the completed job
 * @throws if the job reports `failed` or polling exceeds `maxDurationMs`
 */
export async function pollAsyncJob<TResult = unknown>(
  namespace: string,
  jobId: string,
  options: PollAsyncJobOptions = {},
): Promise<TResult> {
  const intervalMs = options.intervalMs ?? 2000;
  const maxDurationMs = options.maxDurationMs ?? 4 * 60 * 60 * 1000; // 4 hours (to ensure large bulk pushes never time out)
  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > maxDurationMs) {
      throw new Error(
        `Timed out waiting for ${namespace} job. Please refresh and try again.`,
      );
    }

    const resp = await fetch(
      getApiUrl(`/api/jobs/${encodeURIComponent(namespace)}/status/${encodeURIComponent(jobId)}`),
      { method: "GET", credentials: "include" },
    );

    if (!resp.ok) {
      // Hard-fail on definite 4xx (except transient 408 / 429); retry others.
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 408 && resp.status !== 429) {
        const errBody = await resp.json().catch(() => ({} as any));
        throw new Error(
          errBody?.error ||
            errBody?.message ||
            `Failed to fetch job status (HTTP ${resp.status})`,
        );
      }
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }

    const data = (await resp.json().catch(() => ({}))) as AsyncJobStatusResponse<TResult>;

    // Diagnostic: every tick is logged so you can open DevTools and confirm
    // polling is actually happening (and see when a job transitions states).
    console.debug(`[pollAsyncJob:${namespace}]`, {
      jobId,
      status: data?.status,
      step: data?.step,
      progress: data?.progress,
      error: data?.error,
    });

    if (options.onProgress && data?.progress?.message) {
      options.onProgress(data.progress.message, data.progress.percent);
    } else if (options.onProgress && data?.step) {
      options.onProgress(data.step);
    }

    if (data?.status === "completed") {
      return data.result as TResult;
    }
    if (data?.status === "failed") {
      throw new Error(data?.error || `${namespace} job failed on the server.`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
