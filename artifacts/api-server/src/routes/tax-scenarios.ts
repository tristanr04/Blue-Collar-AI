/**
 * Tax Scenarios API routes.
 *
 * Authenticated endpoints for saving, updating, and deleting user tax
 * estimate scenarios. Calculations happen client-side; only inputs + results
 * are persisted so the user can reload them later.
 */

import { Router, type IRouter } from "express";
import { z, ZodError } from "zod";
import type { AuthenticatedRequest } from "../middlewares/auth.js";
import { requireAuthenticatedUser } from "../middlewares/auth.js";
import {
  listTaxScenarios,
  createTaxScenario,
  updateTaxScenario,
  softDeleteTaxScenario,
} from "../lib/tax-scenarios-repository.js";
import { appendAuditEvent } from "../lib/audit-repository.js";
import { appendTimelineEvent } from "../lib/timeline-repository.js";
import { makeTaxEstimateEvent } from "../lib/timeline-events.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.use("/tax-scenarios", requireAuthenticatedUser);

function userId(req: AuthenticatedRequest): string {
  if (!req.authenticatedUserId) throw new Error("Authenticated user ID is missing.");
  return req.authenticatedUserId;
}

function reqId(req: AuthenticatedRequest): string | null {
  return (req as AuthenticatedRequest & { requestId?: string }).requestId ?? null;
}

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  taxYear: z.number().int().min(2024).max(2030).default(2026),
  inputs: z.record(z.unknown()),
  result: z.record(z.unknown()),
});

const UpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  inputs: z.record(z.unknown()).optional(),
  result: z.record(z.unknown()).optional(),
});

function handleError(res: import("express").Response, err: unknown) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Invalid scenario data.", details: err.flatten() });
  }
  logger.error({ err }, "tax_scenarios_error");
  return res.status(500).json({ error: "Could not process tax scenario." });
}

// GET /api/tax-scenarios — list user's saved scenarios
router.get("/tax-scenarios", async (req: AuthenticatedRequest, res) => {
  try {
    const scenarios = await listTaxScenarios(userId(req));
    res.json({ scenarios });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/tax-scenarios — save a new scenario
router.post("/tax-scenarios", async (req: AuthenticatedRequest, res) => {
  try {
    const uid = userId(req);
    const data = CreateSchema.parse(req.body);
    const scenario = await createTaxScenario(uid, data);

    appendAuditEvent({
      userId: uid, action: "create", entityType: "tax_scenario",
      entityId: scenario.id, requestId: reqId(req), source: "api",
    }).catch(() => {});

    appendTimelineEvent(makeTaxEstimateEvent(
      uid,
      { id: scenario.id, updatedAt: scenario.updatedAt, result: scenario.result as Record<string, unknown> },
      null,
    )).catch((err) => logger.error({ err }, "timeline: tax scenario create event failed"));

    res.status(201).json({ scenario });
  } catch (err) {
    handleError(res, err);
  }
});

// PUT /api/tax-scenarios/:id — update an existing scenario
router.put("/tax-scenarios/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const uid = userId(req);
    const id = String(req.params.id);
    const data = UpdateSchema.parse(req.body);
    const scenario = await updateTaxScenario(uid, id, data);

    appendAuditEvent({
      userId: uid, action: "update", entityType: "tax_scenario",
      entityId: scenario.id, requestId: reqId(req), source: "api",
    }).catch(() => {});

    appendTimelineEvent(makeTaxEstimateEvent(
      uid,
      { id: scenario.id, updatedAt: scenario.updatedAt, result: scenario.result as Record<string, unknown> },
      null,
    )).catch((err) => logger.error({ err }, "timeline: tax scenario update event failed"));

    return res.json({ scenario });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return res.status(404).json({ error: err.message });
    }
    return handleError(res, err);
  }
});

// DELETE /api/tax-scenarios/:id — soft-delete a scenario
router.delete("/tax-scenarios/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const uid = userId(req);
    const id = String(req.params.id);
    await softDeleteTaxScenario(uid, id);

    appendAuditEvent({
      userId: uid, action: "delete", entityType: "tax_scenario",
      entityId: id, requestId: reqId(req), source: "api",
    }).catch(() => {});

    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
