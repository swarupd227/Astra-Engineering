/**
 * Generic in-memory async-job manager.
 *
 * Why this exists
 * ---------------
 * AWS API Gateway forcibly closes any HTTP request that exceeds ~29 seconds
 * and returns a synthetic 503 Service Unavailable (recognisable by the
 * `content-length: 33` body — that is the gateway's own timeout response,
 * not the handler's). Any route that performs long-running work (multi-file
 * Git pushes, bulk backlog pushes to Jira/ADO/Confluence, multi-step LLM
 * generation) will hit this limit on AWS.
 *
 * The fix is the standard "202 + jobId, then poll status" pattern. Rather
 * than re-implementing that pattern per route, this module provides a
 * shared registry plus a `runJob` helper. Routes call `runJob`, return 202
 * with the resulting `jobId`, and the client polls
 * `GET /api/jobs/:namespace/status/:jobId` until completion.
 *
 * Notes
 * -----
 * - Jobs live in process memory only. A dev-server restart wipes them.
 *   That's acceptable for the push/polling use case because the client
 *   simply retries on next user action.
 * - Each namespace is an isolated map, so two routes with different
 *   semantics cannot collide jobIds.
 * - Completed jobs are kept for a short TTL after completion so that a
 *   client that finishes polling slightly late still sees the result.
 */

import { randomUUID } from "crypto";

export type AsyncJobStatus = "queued" | "processing" | "completed" | "failed";

export interface AsyncJobProgress {
  percent: number;
  message: string;
  updatedAt: Date;
}

export interface AsyncJob<TResult = unknown> {
  jobId: string;
  namespace: string;
  status: AsyncJobStatus;
  step: string;
  progress?: AsyncJobProgress;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: TResult;
  error?: string;
}

export interface JobHelpers {
  /** Update progress visible to the polling client. */
  updateProgress: (percent: number, message: string) => void;
  /** Convenience step setter (without changing percent). */
  setStep: (message: string) => void;
}

/**
 * Time-to-live for completed/failed jobs (ms). After this period the job is
 * eligible for cleanup so we don't leak memory across long-lived servers.
 */
const TERMINAL_JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes

class AsyncJobManager {
  private namespaces = new Map<string, Map<string, AsyncJob>>();

  private getBucket(namespace: string): Map<string, AsyncJob> {
    let bucket = this.namespaces.get(namespace);
    if (!bucket) {
      bucket = new Map<string, AsyncJob>();
      this.namespaces.set(namespace, bucket);
    }
    return bucket;
  }

  /**
   * Register a new job and immediately start running `work` in the background.
   *
   * The returned promise resolves AS SOON AS the job is registered (NOT when
   * the work completes), so the caller can return 202 + jobId to the client
   * within milliseconds.
   *
   * `work` runs in a fire-and-forget async block; any thrown error is captured
   * onto the job record (status="failed", error message).
   */
  start<TResult>(
    namespace: string,
    work: (helpers: JobHelpers) => Promise<TResult>,
    initialMessage: string = "Job queued",
  ): { jobId: string } {
    const jobId = randomUUID();
    const job: AsyncJob<TResult> = {
      jobId,
      namespace,
      status: "queued",
      step: initialMessage,
      createdAt: new Date(),
      progress: {
        percent: 0,
        message: initialMessage,
        updatedAt: new Date(),
      },
    };
    this.getBucket(namespace).set(jobId, job);

    const helpers: JobHelpers = {
      updateProgress: (percent, message) => {
        const j = this.getBucket(namespace).get(jobId);
        if (!j) return;
        const clamped = Math.max(0, Math.min(100, Math.round(percent)));
        j.progress = { percent: clamped, message, updatedAt: new Date() };
        j.step = message;
      },
      setStep: (message) => {
        const j = this.getBucket(namespace).get(jobId);
        if (!j) return;
        j.step = message;
        if (j.progress) {
          j.progress = { ...j.progress, message, updatedAt: new Date() };
        }
      },
    };

    // Fire and forget — must NOT be awaited in the caller.
    void (async () => {
      const j = this.getBucket(namespace).get(jobId);
      if (j) {
        j.status = "processing";
        j.startedAt = new Date();
      }
      try {
        const result = await work(helpers);
        const finalJob = this.getBucket(namespace).get(jobId);
        if (!finalJob) return;
        finalJob.status = "completed";
        finalJob.step = "Completed";
        finalJob.completedAt = new Date();
        finalJob.result = result;
        finalJob.progress = {
          percent: 100,
          message: "Completed",
          updatedAt: new Date(),
        };
        const elapsed = finalJob.startedAt
          ? ((finalJob.completedAt.getTime() - finalJob.startedAt.getTime()) / 1000).toFixed(1)
          : "?";
        console.log(`[AsyncJob:${namespace}] Job ${jobId} completed in ${elapsed}s.`);
      } catch (err) {
        const finalJob = this.getBucket(namespace).get(jobId);
        if (!finalJob) return;
        const message = err instanceof Error ? err.message : String(err);
        finalJob.status = "failed";
        finalJob.step = "Failed";
        finalJob.completedAt = new Date();
        finalJob.error = message;
        console.error(`[AsyncJob:${namespace}] Job ${jobId} failed:`, message);
      }
    })();

    return { jobId };
  }

  get(namespace: string, jobId: string): AsyncJob | undefined {
    return this.getBucket(namespace).get(jobId);
  }

  /**
   * Drop terminal jobs that have been completed/failed for longer than
   * TERMINAL_JOB_TTL_MS. Called periodically.
   */
  private sweep(): void {
    const now = Date.now();
    for (const bucket of this.namespaces.values()) {
      for (const [jobId, job] of bucket.entries()) {
        if (
          (job.status === "completed" || job.status === "failed") &&
          job.completedAt &&
          now - job.completedAt.getTime() > TERMINAL_JOB_TTL_MS
        ) {
          bucket.delete(jobId);
        }
      }
    }
  }

  startSweepLoop(): void {
    // Idempotent: don't start multiple loops.
    if ((this as any)._sweepLoopStarted) return;
    (this as any)._sweepLoopStarted = true;
    setInterval(() => {
      try {
        this.sweep();
      } catch (e) {
        console.error("[AsyncJobManager] Sweep error:", e);
      }
    }, 5 * 60 * 1000).unref?.();
  }
}

export const asyncJobManager = new AsyncJobManager();
asyncJobManager.startSweepLoop();
