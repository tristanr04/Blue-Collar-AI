import { and, asc, eq, lte, sql } from "drizzle-orm";
import {
  backgroundJobsTable,
  db,
  type BackgroundJobRecord,
  type BackgroundJobType,
} from "@workspace/db";

export interface EnqueueJobInput {
  userId: string;
  jobType: BackgroundJobType;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
}

export async function enqueueBackgroundJob(input: EnqueueJobInput) {
  const [created] = await db
    .insert(backgroundJobsTable)
    .values({
      userId: input.userId,
      jobType: input.jobType,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      maxAttempts: Math.min(Math.max(input.maxAttempts ?? 5, 1), 10),
    })
    .onConflictDoNothing({
      target: [backgroundJobsTable.userId, backgroundJobsTable.idempotencyKey],
    })
    .returning();

  if (created) return created;

  return db.query.backgroundJobsTable.findFirst({
    where: and(
      eq(backgroundJobsTable.userId, input.userId),
      eq(backgroundJobsTable.idempotencyKey, input.idempotencyKey),
    ),
  });
}

export async function getBackgroundJobForUser(userId: string, jobId: string) {
  return db.query.backgroundJobsTable.findFirst({
    where: and(eq(backgroundJobsTable.id, jobId), eq(backgroundJobsTable.userId, userId)),
  });
}

/**
 * Atomically claims one ready job. PostgreSQL SKIP LOCKED allows multiple workers
 * to compete without processing the same row.
 */
export async function claimNextBackgroundJob(workerId: string): Promise<BackgroundJobRecord | null> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql<BackgroundJobRecord>`
      SELECT *
      FROM background_jobs
      WHERE status = 'queued'
        AND available_at <= now()
        AND attempts < max_attempts
      ORDER BY available_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    const job = rows.rows[0] as BackgroundJobRecord | undefined;
    if (!job) return null;

    const [claimed] = await tx
      .update(backgroundJobsTable)
      .set({
        status: "running",
        lockedAt: new Date(),
        lockedBy: workerId,
        startedAt: job.startedAt ?? new Date(),
        attempts: job.attempts + 1,
        updatedAt: new Date(),
      })
      .where(eq(backgroundJobsTable.id, job.id))
      .returning();

    return claimed ?? null;
  });
}

export async function completeBackgroundJob(
  jobId: string,
  workerId: string,
  result: Record<string, unknown>,
): Promise<boolean> {
  const rows = await db
    .update(backgroundJobsTable)
    .set({
      status: "succeeded",
      result,
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(backgroundJobsTable.id, jobId),
        eq(backgroundJobsTable.status, "running"),
        eq(backgroundJobsTable.lockedBy, workerId),
      ),
    )
    .returning({ id: backgroundJobsTable.id });

  return rows.length === 1;
}

export async function failBackgroundJob(
  job: BackgroundJobRecord,
  workerId: string,
  error: { code: string; message: string },
): Promise<boolean> {
  const exhausted = job.attempts >= job.maxAttempts;
  const retryDelaySeconds = Math.min(15 * 2 ** Math.max(job.attempts - 1, 0), 15 * 60);

  const rows = await db
    .update(backgroundJobsTable)
    .set({
      status: exhausted ? "failed" : "queued",
      errorCode: error.code.slice(0, 100),
      errorMessage: error.message.slice(0, 1000),
      availableAt: exhausted ? job.availableAt : new Date(Date.now() + retryDelaySeconds * 1000),
      completedAt: exhausted ? new Date() : null,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(backgroundJobsTable.id, job.id),
        eq(backgroundJobsTable.status, "running"),
        eq(backgroundJobsTable.lockedBy, workerId),
      ),
    )
    .returning({ id: backgroundJobsTable.id });

  return rows.length === 1;
}

export async function releaseStaleBackgroundJobs(staleBefore: Date): Promise<number> {
  const rows = await db
    .update(backgroundJobsTable)
    .set({
      status: "queued",
      lockedAt: null,
      lockedBy: null,
      availableAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(backgroundJobsTable.status, "running"),
        lte(backgroundJobsTable.lockedAt, staleBefore),
      ),
    )
    .returning({ id: backgroundJobsTable.id });

  return rows.length;
}

export async function listQueuedJobsForUser(userId: string, limit = 25) {
  return db
    .select()
    .from(backgroundJobsTable)
    .where(eq(backgroundJobsTable.userId, userId))
    .orderBy(asc(backgroundJobsTable.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}
