import { Router, type IRouter, type Response } from "express";
import { ZodError, z } from "zod";
import type { AuthenticatedRequest } from "../middlewares/auth.js";
import { requireAuthenticatedUser } from "../middlewares/auth.js";
import { appendAuditEvent, type AuditAction } from "../lib/audit-repository.js";
import {
  createAsset,
  createBill,
  createDebt,
  createPaystub,
  ensureUser,
  getAssetById,
  getBillById,
  getDebtById,
  getFinancialSnapshot,
  getPaystubById,
  softDeleteFinancialRecord,
  updateAsset,
  updateBill,
  updateDebt,
  updatePaystub,
  upsertProfile,
} from "../lib/financial-repository.js";
import { appendTimelineEvent } from "../lib/timeline-repository.js";
import {
  makeAssetEvent,
  makeBillEvent,
  makeDebtEvent,
  makePaystubEvent,
} from "../lib/timeline-events.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.use("/financial", requireAuthenticatedUser);

function userIdFrom(req: AuthenticatedRequest): string {
  if (!req.authenticatedUserId) throw new Error("Authenticated user ID is missing.");
  return req.authenticatedUserId;
}

function requestIdFrom(req: AuthenticatedRequest): string | null {
  const requestId = (req as AuthenticatedRequest & { id?: unknown }).id;
  if (typeof requestId === "string" && requestId.length > 0) return requestId;
  const header = req.get("x-request-id");
  return header && header.length > 0 ? header : null;
}

async function recordAudit(
  req: AuthenticatedRequest,
  input: {
    userId: string;
    action: AuditAction;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await appendAuditEvent({
      ...input,
      requestId: requestIdFrom(req),
      source: "api",
    });
  } catch (error) {
    logger.error(
      {
        err: error,
        event: "audit_append_failed",
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        requestId: requestIdFrom(req),
      },
      "financial mutation succeeded but audit event could not be persisted",
    );
  }
}

/** Fire-and-forget timeline event. Errors are logged but never fail the request. */
async function recordTimeline(
  input: Parameters<typeof appendTimelineEvent>[0],
): Promise<void> {
  try {
    await appendTimelineEvent(input);
  } catch (error) {
    logger.error(
      { err: error, eventType: input.eventType, userId: input.userId },
      "financial mutation succeeded but timeline event could not be persisted",
    );
  }
}

function sendRepositoryError(res: Response, error: unknown): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      stage: "request_validation",
      error: "Financial record is invalid.",
      fieldErrors: error.flatten().fieldErrors,
    });
    return;
  }

  logger.error({ err: error }, "financial repository request failed");
  res.status(500).json({
    stage: "database",
    error: "Financial data could not be saved right now.",
  });
}

router.get("/financial/snapshot", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    await ensureUser({ userId });
    res.json(await getFinancialSnapshot(userId));
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

router.put("/financial/profile", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    await ensureUser({ userId });
    const profile = await upsertProfile(userId, req.body);
    await recordAudit(req, {
      userId,
      action: "update",
      entityType: "profile",
      entityId: profile.id,
      metadata: { operation: "upsert" },
    });
    res.json(profile);
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

// ─── Paystubs ────────────────────────────────────────────────────────────────

router.post("/financial/paystubs", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    await ensureUser({ userId });
    const created = await createPaystub(userId, req.body);
    await recordAudit(req, {
      userId,
      action: "create",
      entityType: "paystub",
      entityId: created.id,
    });
    void recordTimeline(makePaystubEvent(
      userId,
      { id: created.id, payDate: created.payDate, netPay: created.netPay },
      null,
      false,
    ));
    res.status(201).json(created);
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

router.put("/financial/paystubs/:recordId", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    const recordId = z.string().uuid().parse(req.params.recordId);
    const old = await getPaystubById(userId, recordId);
    const updated = await updatePaystub(userId, recordId, req.body);
    if (!updated) {
      res.status(404).json({
        stage: "record_not_found",
        error: "Paystub not found or does not belong to this account.",
      });
      return;
    }
    await recordAudit(req, { userId, action: "update", entityType: "paystub", entityId: recordId });
    void recordTimeline(makePaystubEvent(
      userId,
      { id: updated.id, payDate: updated.payDate, netPay: updated.netPay },
      old?.netPay ?? null,
      true,
    ));
    res.json(updated);
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

// ─── Debts ────────────────────────────────────────────────────────────────────

router.post("/financial/debts", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    await ensureUser({ userId });
    const created = await createDebt(userId, req.body);
    await recordAudit(req, { userId, action: "create", entityType: "debt", entityId: created.id });
    void recordTimeline(makeDebtEvent(
      userId,
      { id: created.id, name: created.name, balance: created.balance, isRevolving: created.isRevolving, updatedAt: created.updatedAt },
      null,
      false,
    ));
    res.status(201).json(created);
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

router.put("/financial/debts/:recordId", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    const recordId = z.string().uuid().parse(req.params.recordId);
    const old = await getDebtById(userId, recordId);
    const updated = await updateDebt(userId, recordId, req.body);
    if (!updated) {
      res.status(404).json({ stage: "record_not_found", error: "Debt not found or does not belong to this account." });
      return;
    }
    await recordAudit(req, { userId, action: "update", entityType: "debt", entityId: recordId });
    void recordTimeline(makeDebtEvent(
      userId,
      { id: updated.id, name: updated.name, balance: updated.balance, isRevolving: updated.isRevolving, updatedAt: updated.updatedAt },
      old?.balance ?? null,
      true,
    ));
    res.json(updated);
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

// ─── Bills ────────────────────────────────────────────────────────────────────

router.post("/financial/bills", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    await ensureUser({ userId });
    const created = await createBill(userId, req.body);
    await recordAudit(req, { userId, action: "create", entityType: "bill", entityId: created.id });
    void recordTimeline(makeBillEvent(
      userId,
      { id: created.id, name: created.name, amount: created.amount, updatedAt: created.updatedAt },
      null,
      false,
    ));
    res.status(201).json(created);
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

router.put("/financial/bills/:recordId", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    const recordId = z.string().uuid().parse(req.params.recordId);
    const old = await getBillById(userId, recordId);
    const updated = await updateBill(userId, recordId, req.body);
    if (!updated) {
      res.status(404).json({ stage: "record_not_found", error: "Bill not found or does not belong to this account." });
      return;
    }
    await recordAudit(req, { userId, action: "update", entityType: "bill", entityId: recordId });
    void recordTimeline(makeBillEvent(
      userId,
      { id: updated.id, name: updated.name, amount: updated.amount, updatedAt: updated.updatedAt },
      old?.amount ?? null,
      true,
    ));
    res.json(updated);
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

// ─── Assets ────────────────────────────────────────────────────────────────────

router.post("/financial/assets", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    await ensureUser({ userId });
    const created = await createAsset(userId, req.body);
    await recordAudit(req, { userId, action: "create", entityType: "asset", entityId: created.id });
    void recordTimeline(makeAssetEvent(
      userId,
      { id: created.id, name: created.name, type: created.type, value: created.value, updatedAt: created.updatedAt },
      null,
      false,
    ));
    res.status(201).json(created);
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

router.put("/financial/assets/:recordId", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    const recordId = z.string().uuid().parse(req.params.recordId);
    const old = await getAssetById(userId, recordId);
    const updated = await updateAsset(userId, recordId, req.body);
    if (!updated) {
      res.status(404).json({ stage: "record_not_found", error: "Asset not found or does not belong to this account." });
      return;
    }
    await recordAudit(req, { userId, action: "update", entityType: "asset", entityId: recordId });
    void recordTimeline(makeAssetEvent(
      userId,
      { id: updated.id, name: updated.name, type: updated.type, value: updated.value, updatedAt: updated.updatedAt },
      old?.value ?? null,
      true,
    ));
    res.json(updated);
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

// ─── Delete (any section) ─────────────────────────────────────────────────────

const deleteParamsSchema = z.object({
  section: z.enum(["paystubs", "debts", "bills", "assets"]),
  recordId: z.string().uuid(),
});

router.delete("/financial/:section/:recordId", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    const params = deleteParamsSchema.parse(req.params);
    const deleted = await softDeleteFinancialRecord(userId, params.section, params.recordId);

    if (!deleted) {
      res.status(404).json({
        stage: "record_not_found",
        error: "Record was not found or does not belong to this account.",
      });
      return;
    }

    await recordAudit(req, {
      userId,
      action: "delete",
      entityType: params.section.slice(0, -1),
      entityId: params.recordId,
      metadata: { softDelete: true },
    });
    res.status(204).end();
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

export default router;
