import { Router, type IRouter, type Response } from "express";
import { ZodError, z } from "zod";
import type { AuthenticatedRequest } from "../middlewares/auth.js";
import { requireAuthenticatedUser } from "../middlewares/auth.js";
import {
  listGoals,
  getGoalById,
  createGoal,
  updateGoal,
  contributeToGoal,
  archiveGoal,
  getOrCreateEmergencyFundGoal,
  CreateGoalSchema,
  UpdateGoalSchema,
  ContributeSchema,
} from "../lib/goals-repository.js";
import { appendAuditEvent } from "../lib/audit-repository.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
router.use("/goals", requireAuthenticatedUser);

function uid(req: AuthenticatedRequest): string {
  if (!req.authenticatedUserId) throw new Error("Missing authenticated user ID.");
  return req.authenticatedUserId;
}

function requestId(req: AuthenticatedRequest): string | null {
  return (req as any).requestId ?? req.get("x-request-id") ?? null;
}

function handleError(res: Response, error: unknown) {
  if (error instanceof ZodError) {
    return res.status(400).json({ error: "Invalid input.", details: error.flatten() });
  }
  logger.error({ error }, "goals_route_error");
  return res.status(500).json({ error: "Could not process goal request." });
}

// GET /api/goals — list all active goals for the authenticated user
router.get("/goals", async (req: AuthenticatedRequest, res) => {
  try {
    const goals = await listGoals(uid(req));
    return res.json({ goals });
  } catch (error) {
    return handleError(res, error);
  }
});

// POST /api/goals — create a new goal
router.post("/goals", async (req: AuthenticatedRequest, res) => {
  try {
    const input = CreateGoalSchema.parse(req.body);
    const goal = await createGoal(uid(req), input);
    appendAuditEvent({
      userId: uid(req), action: "create", entityType: "goal", entityId: goal.id,
      requestId: requestId(req), source: "api",
    }).catch(() => {});
    return res.status(201).json({ goal });
  } catch (error) {
    return handleError(res, error);
  }
});

// GET /api/goals/emergency-fund — get or auto-create the emergency fund goal
router.get("/goals/emergency-fund", async (req: AuthenticatedRequest, res) => {
  try {
    const suggestedTarget = Number(req.query.suggestedTarget) || 5000;
    const goal = await getOrCreateEmergencyFundGoal(uid(req), suggestedTarget);
    return res.json({ goal });
  } catch (error) {
    return handleError(res, error);
  }
});

// GET /api/goals/:id
router.get("/goals/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const goal = await getGoalById(uid(req), String(req.params["id"]));
    if (!goal) return res.status(404).json({ error: "Goal not found." });
    return res.json({ goal });
  } catch (error) {
    return handleError(res, error);
  }
});

// PATCH /api/goals/:id
router.patch("/goals/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const input = UpdateGoalSchema.parse(req.body);
    const goal = await updateGoal(uid(req), String(req.params["id"]), input);
    if (!goal) return res.status(404).json({ error: "Goal not found." });
    appendAuditEvent({
      userId: uid(req), action: "update", entityType: "goal", entityId: goal.id,
      requestId: requestId(req), source: "api",
    }).catch(() => {});
    return res.json({ goal });
  } catch (error) {
    return handleError(res, error);
  }
});

// POST /api/goals/:id/contribute — add or subtract from current_amount
router.post("/goals/:id/contribute", async (req: AuthenticatedRequest, res) => {
  try {
    const { amount } = ContributeSchema.parse(req.body);
    const goal = await contributeToGoal(uid(req), String(req.params["id"]), amount);
    if (!goal) return res.status(404).json({ error: "Goal not found." });
    appendAuditEvent({
      userId: uid(req), action: "update", entityType: "goal", entityId: goal.id,
      requestId: requestId(req), source: "api",
      metadata: { amount },
    }).catch(() => {});
    return res.json({ goal });
  } catch (error) {
    return handleError(res, error);
  }
});

// DELETE /api/goals/:id — soft-delete (archive)
router.delete("/goals/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const deleted = await archiveGoal(uid(req), String(req.params["id"]));
    if (!deleted) return res.status(404).json({ error: "Goal not found." });
    appendAuditEvent({
      userId: uid(req), action: "delete", entityType: "goal", entityId: String(req.params["id"]),
      requestId: requestId(req), source: "api",
    }).catch(() => {});
    return res.json({ deleted: true });
  } catch (error) {
    return handleError(res, error);
  }
});

export default router;
