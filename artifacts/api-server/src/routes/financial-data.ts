import { Router, type IRouter, type Response } from "express";
import { ZodError, z } from "zod";
import type { AuthenticatedRequest } from "../middlewares/auth.js";
import { requireAuthenticatedUser } from "../middlewares/auth.js";
import {
  createAsset,
  createBill,
  createDebt,
  createPaystub,
  ensureUser,
  getFinancialSnapshot,
  softDeleteFinancialRecord,
  updateAsset,
  updateBill,
  updateDebt,
  upsertProfile,
} from "../lib/financial-repository.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.use("/financial", requireAuthenticatedUser);

function userIdFrom(req: AuthenticatedRequest): string {
  if (!req.authenticatedUserId) throw new Error("Authenticated user ID is missing.");
  return req.authenticatedUserId;
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
    res.json(await upsertProfile(userId, req.body));
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

// ─── Paystubs ────────────────────────────────────────────────────────────────

router.post("/financial/paystubs", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    await ensureUser({ userId });
    res.status(201).json(await createPaystub(userId, req.body));
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

// ─── Debts ────────────────────────────────────────────────────────────────────

router.post("/financial/debts", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    await ensureUser({ userId });
    res.status(201).json(await createDebt(userId, req.body));
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

router.put("/financial/debts/:recordId", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    const recordId = z.string().uuid().parse(req.params.recordId);
    const updated = await updateDebt(userId, recordId, req.body);
    if (!updated) {
      res.status(404).json({ stage: "record_not_found", error: "Debt not found or does not belong to this account." });
      return;
    }
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
    res.status(201).json(await createBill(userId, req.body));
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

router.put("/financial/bills/:recordId", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    const recordId = z.string().uuid().parse(req.params.recordId);
    const updated = await updateBill(userId, recordId, req.body);
    if (!updated) {
      res.status(404).json({ stage: "record_not_found", error: "Bill not found or does not belong to this account." });
      return;
    }
    res.json(updated);
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

// ─── Assets ───────────────────────────────────────────────────────────────────

router.post("/financial/assets", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    await ensureUser({ userId });
    res.status(201).json(await createAsset(userId, req.body));
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

router.put("/financial/assets/:recordId", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = userIdFrom(req);
    const recordId = z.string().uuid().parse(req.params.recordId);
    const updated = await updateAsset(userId, recordId, req.body);
    if (!updated) {
      res.status(404).json({ stage: "record_not_found", error: "Asset not found or does not belong to this account." });
      return;
    }
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

    res.status(204).end();
  } catch (error) {
    sendRepositoryError(res, error);
  }
});

export default router;
