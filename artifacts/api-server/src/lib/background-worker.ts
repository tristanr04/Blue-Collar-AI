import { randomUUID } from "node:crypto";
import type { BackgroundJobRecord, BackgroundJobType } from "@workspace/db";
import {
  claimNextBackgroundJob,
  completeBackgroundJob,
  failBackgroundJob,
  releaseStaleBackgroundJobs,
} from "./background-job-repository.js";
import { logger } from "./logger.js";

export type BackgroundJobHandler = (
  job: BackgroundJobRecord,
) => Promise<Record<string, unknown>>;

export type BackgroundJobHandlers = Partial<
  Record<BackgroundJobType, BackgroundJobHandler>
>;

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_STALE_LOCK_MS = 10 * 60_000;

export class BackgroundWorker {
  readonly workerId: string;
  private stopped = false;

  constructor(
    private readonly handlers: BackgroundJobHandlers,
    workerId = `worker-${randomUUID()}`,
  ) {
    this.workerId = workerId;
  }

  stop(): void {
    this.stopped = true;
  }

  async runOne(): Promise<boolean> {
    const job = await claimNextBackgroundJob(this.workerId);
    if (!job) return false;

    const handler = this.handlers[job.jobType];
    if (!handler) {
      await failBackgroundJob(job, this.workerId, {
        code: "handler_not_configured",
        message: `No worker handler is configured for ${job.jobType}.`,
      });
      return true;
    }

    try {
      const result = await handler(job);
      const completed = await completeBackgroundJob(job.id, this.workerId, result);
      if (!completed) {
        logger.warn(
          { jobId: job.id, workerId: this.workerId },
          "background job completion lost ownership",
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Background job failed.";
      await failBackgroundJob(job, this.workerId, {
        code: "job_execution_failed",
        message,
      });
      logger.error(
        { err: error, jobId: job.id, jobType: job.jobType, workerId: this.workerId },
        "background job execution failed",
      );
    }

    return true;
  }

  async run(options: { pollIntervalMs?: number; staleLockMs?: number } = {}): Promise<void> {
    const pollIntervalMs = Math.max(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, 100);
    const staleLockMs = Math.max(options.staleLockMs ?? DEFAULT_STALE_LOCK_MS, 60_000);

    await releaseStaleBackgroundJobs(new Date(Date.now() - staleLockMs));

    while (!this.stopped) {
      const processed = await this.runOne();
      if (!processed) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
  }
}
