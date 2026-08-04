/**
 * Migration route — idempotent bulk local→server migration.
 *
 * POST /api/migrate
 *   Accepts the user's full local financial dataset plus a client-generated
 *   idempotency key.  Commits everything in a single DB transaction.
 *   Retries with the same key return the original result without re-inserting.
 *
 * GET /api/migrate/status/:key
 *   Polling endpoint.  Returns the current job status so the client can
 *   reconcile after a network disconnect that occurred after the server committed.
 */

import { Router } from "express";
import express from "express";
import { z } from "zod";
import { MigrateRequestSchema } from "@workspace/api-zod";
import { validateBody } from "../lib/validate.js";
import { requireAuthenticatedUser } from "../middlewares/auth.js";
import type { AuthenticatedRequest } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";
import {
  startMigrationJob,
  runMigrationInTransaction,
  failMigrationJob,
  getMigrationStatus,
} from "../lib/migration-repository.js";

const router = Router();

// Larger body limit for bulk migration payloads (up to 500 records × 4 sections).
// Applied before the global 250 KB cap so large payloads are accepted here only.
router.use(express.json({ limit: "2mb" }));

// All /migrate routes require a valid Clerk session.
router.use(requireAuthenticatedUser);

// ─── POST /migrate ────────────────────────────────────────────────────────────

router.post(
  "/migrate",
  validateBody(MigrateRequestSchema, "migrate_request"),
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).authenticatedUserId!;
    const { idempotencyKey, profile, paystubs, debts, bills, assets } =
      req.body;

    // ── Phase 1: claim the idempotency key (auto-commit INSERT) ──────────────
    let job: Awaited<ReturnType<typeof startMigrationJob>>["job"];
    let isNew: boolean;
    try {
      ({ job, isNew } = await startMigrationJob(userId, idempotencyKey));
    } catch (dbErr) {
      logger.error({ err: dbErr, userId }, "migrate: failed to claim idempotency key");
      res.status(503).json({
        stage: "database",
        error: "Could not start migration. Please try again.",
      });
      return;
    }

    // Already committed by a previous request — return cached result.
    if (job.status === "committed") {
      res.json({
        idempotencyKey,
        status: "committed",
        result: job.result,
        committedAt: job.committedAt,
      });
      return;
    }

    // Key exists but not committed — concurrent request or a failed prior attempt.
    // Return current status; client will poll.
    if (!isNew) {
      res.json({
        idempotencyKey,
        status: job.status,
        errorMessage: job.errorMessage ?? undefined,
      });
      return;
    }

    // ── Phase 2: run the entire migration in a single DB transaction ──────────
    try {
      const result = await runMigrationInTransaction(userId, job.id, {
        profile,
        paystubs: paystubs ?? [],
        debts: debts ?? [],
        bills: bills ?? [],
        assets: assets ?? [],
      });

      logger.info(
        {
          userId,
          idempotencyKey,
          counts: {
            paystubs: result.paystubs.length,
            debts: result.debts.length,
            bills: result.bills.length,
            assets: result.assets.length,
          },
        },
        "migrate: committed",
      );

      res.json({ idempotencyKey, status: "committed", result });
    } catch (err) {
      logger.error(
        { err, userId, idempotencyKey },
        "migrate: transaction failed — rolling back and marking job failed",
      );

      // Mark failed in a separate auto-commit statement so it survives the
      // rolled-back transaction.
      await failMigrationJob(
        job.id,
        err instanceof Error ? err.message : String(err),
      ).catch((markErr) =>
        logger.error(
          { err: markErr },
          "migrate: failed to mark job as failed after rollback",
        ),
      );

      res.status(500).json({
        stage: "migration_transaction",
        idempotencyKey,
        error:
          "Migration failed and was fully rolled back. Your local data is unchanged. Please try again.",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

// ─── GET /migrate/status/:key ─────────────────────────────────────────────────

router.get("/migrate/status/:key", async (req, res) => {
  const userId = (req as AuthenticatedRequest).authenticatedUserId!;

  const parsed = z.string().uuid().safeParse(req.params.key);
  if (!parsed.success) {
    res.status(400).json({
      stage: "validation",
      error: "idempotency key must be a valid UUID.",
    });
    return;
  }

  let job: Awaited<ReturnType<typeof getMigrationStatus>>;
  try {
    job = await getMigrationStatus(userId, parsed.data);
  } catch (dbErr) {
    logger.error({ err: dbErr }, "migrate/status: DB error");
    res.status(503).json({
      stage: "database",
      error: "Could not check migration status. Please try again.",
    });
    return;
  }

  if (!job) {
    res.status(404).json({
      stage: "not_found",
      error: "No migration found for this key. The migration may have failed and rolled back.",
    });
    return;
  }

  // Surface stale pending rows as failed so the client can retry.
  const effectiveStatus = job.isStale ? "failed" : job.status;
  const effectiveError = job.isStale
    ? "Migration timed out (server may have restarted mid-migration). Please try again."
    : (job.errorMessage ?? undefined);

  res.json({
    idempotencyKey: parsed.data,
    status: effectiveStatus,
    result: job.result ?? undefined,
    errorMessage: effectiveError,
    committedAt: job.committedAt ?? undefined,
    createdAt: job.createdAt,
  });
});

export default router;
