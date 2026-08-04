/**
 * Migration repository — atomic bulk import with idempotency.
 *
 * Every local→server migration is wrapped in a single PostgreSQL transaction.
 * The idempotency key (a UUID the client generates and persists in localStorage)
 * is stored in migration_jobs with a UNIQUE(user_id, idempotency_key) constraint,
 * guaranteeing that:
 *
 *  - Retries (same key)      → return the original result, no duplicate rows.
 *  - Concurrent submissions  → only ONE wins the INSERT; the other polls for status.
 *  - Disconnect after commit → client polls GET /migrate/status/:key → gets result.
 *  - Partial failure         → transaction rolls back all inserts; job marked failed.
 */

import { and, eq } from "drizzle-orm";
import {
  assetsTable,
  billsTable,
  db,
  debtsTable,
  insertAssetSchema,
  insertBillSchema,
  insertDebtSchema,
  insertPaystubSchema,
  insertProfileSchema,
  migrationJobsTable,
  paystubsTable,
  profilesTable,
  usersTable,
} from "@workspace/db";
import type { MigrationResult } from "@workspace/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MigrationRecordItem {
  clientId: string;
  [key: string]: unknown;
}

export interface MigrationPayload {
  profile?: Record<string, unknown>;
  paystubs: MigrationRecordItem[];
  debts: MigrationRecordItem[];
  bills: MigrationRecordItem[];
  assets: MigrationRecordItem[];
}

export type MigrationJobRow = typeof migrationJobsTable.$inferSelect & {
  isStale?: boolean;
};

/** A 'pending' row older than 10 min is stale (server crashed during migration). */
const STALE_PENDING_MS = 10 * 60 * 1000;

// ─── Phase 1: Claim idempotency key (auto-commit) ─────────────────────────────

/**
 * Attempt to INSERT a 'pending' migration_jobs row.
 *
 * - Returns `{ job, isNew: true }` when the key is new (caller runs the migration).
 * - Returns `{ job, isNew: false }` when the key already exists (caller returns the
 *   existing status to the client without touching the DB).
 */
export async function startMigrationJob(
  userId: string,
  idempotencyKey: string,
): Promise<{ job: MigrationJobRow; isNew: boolean }> {
  // ON CONFLICT DO NOTHING: no unique-violation error, just returns 0 rows.
  const inserted = await db
    .insert(migrationJobsTable)
    .values({ userId, idempotencyKey, status: "pending" })
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) {
    return { job: inserted[0], isNew: true };
  }

  // Key already exists — fetch the current row.
  const [existing] = await db
    .select()
    .from(migrationJobsTable)
    .where(
      and(
        eq(migrationJobsTable.userId, userId),
        eq(migrationJobsTable.idempotencyKey, idempotencyKey),
      ),
    );

  // Existing row will always be present here because the key must have been
  // inserted by a prior request (the UNIQUE constraint caught our INSERT).
  return { job: existing, isNew: false };
}

// ─── Phase 2: Run migration inside a transaction ──────────────────────────────

/**
 * Execute the full migration atomically.
 *
 * All record inserts AND the job status update to 'committed' are wrapped in a
 * single Drizzle transaction.  If anything throws, the transaction rolls back
 * completely — no partial records are left in the database.
 *
 * The caller (route handler) must call `failMigrationJob` in the catch block so
 * the status endpoint can tell the client that a retry is needed.
 */
export async function runMigrationInTransaction(
  userId: string,
  jobId: string,
  payload: MigrationPayload,
): Promise<MigrationResult> {
  return db.transaction(async (tx) => {
    // 1. Ensure the user row exists inside the transaction.
    await tx
      .insert(usersTable)
      .values({ id: userId })
      .onConflictDoUpdate({
        target: usersTable.id,
        set: { updatedAt: new Date() },
      });

    // 2. Upsert the financial profile if provided.
    if (payload.profile && Object.keys(payload.profile).length > 0) {
      const profileInput = insertProfileSchema.partial().parse(payload.profile);
      await tx
        .insert(profilesTable)
        .values({ userId, ...profileInput })
        .onConflictDoUpdate({
          target: profilesTable.userId,
          set: { ...profileInput, updatedAt: new Date() },
        });
    }

    const result: MigrationResult = {
      paystubs: [],
      debts: [],
      bills: [],
      assets: [],
    };

    // 3. Insert paystubs — each validated with the Drizzle-zod insert schema.
    for (const item of payload.paystubs) {
      const { clientId, ...raw } = item;
      // payDate may arrive as an ISO string from the client.
      const parsed = insertPaystubSchema.parse({
        ...raw,
        payDate:
          raw.payDate instanceof Date
            ? raw.payDate
            : raw.payDate
              ? new Date(raw.payDate as string)
              : undefined,
      });
      const [row] = await tx
        .insert(paystubsTable)
        .values({ userId, ...parsed })
        .returning({ id: paystubsTable.id });
      result.paystubs.push({ clientId, serverId: row.id });
    }

    // 4. Insert debts.
    for (const item of payload.debts) {
      const { clientId, ...raw } = item;
      const parsed = insertDebtSchema.parse(raw);
      const [row] = await tx
        .insert(debtsTable)
        .values({ userId, ...parsed })
        .returning({ id: debtsTable.id });
      result.debts.push({ clientId, serverId: row.id });
    }

    // 5. Insert bills.
    for (const item of payload.bills) {
      const { clientId, ...raw } = item;
      const parsed = insertBillSchema.parse(raw);
      const [row] = await tx
        .insert(billsTable)
        .values({ userId, ...parsed })
        .returning({ id: billsTable.id });
      result.bills.push({ clientId, serverId: row.id });
    }

    // 6. Insert assets.
    for (const item of payload.assets) {
      const { clientId, ...raw } = item;
      const parsed = insertAssetSchema.parse(raw);
      const [row] = await tx
        .insert(assetsTable)
        .values({ userId, ...parsed })
        .returning({ id: assetsTable.id });
      result.assets.push({ clientId, serverId: row.id });
    }

    // 7. Mark the job committed — inside the same transaction so this is atomic
    //    with all the inserts above.
    const now = new Date();
    await tx
      .update(migrationJobsTable)
      .set({
        status: "committed",
        result,
        committedAt: now,
        updatedAt: now,
        recordCounts: {
          paystubs: result.paystubs.length,
          debts: result.debts.length,
          bills: result.bills.length,
          assets: result.assets.length,
        },
      })
      .where(eq(migrationJobsTable.id, jobId));

    return result;
  });
}

// ─── Failure marker (separate auto-commit) ────────────────────────────────────

/**
 * Mark a migration job as failed.  Called in the catch block after a transaction
 * failure so the status endpoint can inform the client.
 *
 * This is a standalone statement (NOT in a transaction) so it commits even when
 * the migration transaction has already rolled back.
 */
export async function failMigrationJob(
  jobId: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(migrationJobsTable)
    .set({ status: "failed", errorMessage, updatedAt: new Date() })
    .where(eq(migrationJobsTable.id, jobId));
}

// ─── Status poll ─────────────────────────────────────────────────────────────

/**
 * Fetch the current migration job for a (userId, idempotencyKey) pair.
 * Returns null if not found (key never submitted or rolled back).
 * Adds `isStale: true` when a 'pending' row is older than STALE_PENDING_MS.
 */
export async function getMigrationStatus(
  userId: string,
  idempotencyKey: string,
): Promise<MigrationJobRow | null> {
  const [job] = await db
    .select()
    .from(migrationJobsTable)
    .where(
      and(
        eq(migrationJobsTable.userId, userId),
        eq(migrationJobsTable.idempotencyKey, idempotencyKey),
      ),
    );

  if (!job) return null;

  const isStale =
    job.status === "pending" &&
    Date.now() - job.createdAt.getTime() > STALE_PENDING_MS;

  return { ...job, isStale };
}
