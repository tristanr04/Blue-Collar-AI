/**
 * Debt payoff plans — CRUD for saved strategies plus on-demand calculation.
 *
 * Two modes:
 *  POST /api/debt-payoff/calculate  — ephemeral, stateless calculation (no DB)
 *  POST /api/debt-payoff/plans      — save a plan to DB
 *  GET  /api/debt-payoff/plans      — list saved plans
 *  GET  /api/debt-payoff/plans/:id  — get plan with recalculated schedule
 *  PATCH /api/debt-payoff/plans/:id — update a plan
 *  DELETE /api/debt-payoff/plans/:id — archive a plan
 */

import { Router, type IRouter, type Response } from "express";
import { ZodError, z } from "zod";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { AuthenticatedRequest } from "../middlewares/auth.js";
import { requireAuthenticatedUser } from "../middlewares/auth.js";
import { calculatePayoffSchedule } from "../lib/payoff-calculator.js";
import { db, debtPayoffPlansTable, debtsTable } from "@workspace/db";
import { appendAuditEvent } from "../lib/audit-repository.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
router.use("/debt-payoff", requireAuthenticatedUser);

const StrategyEnum = z.enum(["avalanche", "snowball", "utilization", "custom"]);

const CalculateSchema = z.object({
  strategy: StrategyEnum,
  extraMonthlyPayment: z.number().min(0).max(100_000).default(0),
  customOrder: z.array(z.string().uuid()).max(100).optional(),
});

const SavePlanSchema = z.object({
  name: z.string().trim().min(1).max(200),
  strategy: StrategyEnum,
  extraMonthlyPayment: z.number().min(0).max(100_000).default(0),
  customOrder: z.array(z.string().uuid()).max(100).optional(),
});

const UpdatePlanSchema = SavePlanSchema.partial();

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
  logger.error({ error }, "debt_payoff_route_error");
  return res.status(500).json({ error: "Could not process debt payoff request." });
}

/** Load the user's active debts for calculation. */
async function loadUserDebts(userId: string) {
  return db
    .select()
    .from(debtsTable)
    .where(and(eq(debtsTable.userId, userId), isNull(debtsTable.deletedAt)));
}

// ─── Ephemeral calculation ────────────────────────────────────────────────────

// POST /api/debt-payoff/calculate — compute on-the-fly without saving
router.post("/debt-payoff/calculate", async (req: AuthenticatedRequest, res) => {
  try {
    const input = CalculateSchema.parse(req.body);
    const debts = await loadUserDebts(uid(req));

    const schedule = calculatePayoffSchedule({
      debts: debts.map((d) => ({
        id: d.id,
        name: d.name,
        balance: d.balance,
        interestRate: d.interestRate,
        minimumPayment: d.minimumPayment,
        creditLimit: d.creditLimit ?? undefined,
        isRevolving: d.isRevolving,
      })),
      strategy: input.strategy,
      extraMonthlyPayment: input.extraMonthlyPayment,
      customOrder: input.customOrder,
    });

    return res.json({ schedule });
  } catch (error) {
    return handleError(res, error);
  }
});

// ─── Saved plans ──────────────────────────────────────────────────────────────

// GET /api/debt-payoff/plans
router.get("/debt-payoff/plans", async (req: AuthenticatedRequest, res) => {
  try {
    const plans = await db
      .select()
      .from(debtPayoffPlansTable)
      .where(
        and(
          eq(debtPayoffPlansTable.userId, uid(req)),
          ne(debtPayoffPlansTable.status, "archived"),
        ),
      );
    return res.json({ plans });
  } catch (error) {
    return handleError(res, error);
  }
});

// POST /api/debt-payoff/plans
router.post("/debt-payoff/plans", async (req: AuthenticatedRequest, res) => {
  try {
    const input = SavePlanSchema.parse(req.body);
    const [plan] = await db
      .insert(debtPayoffPlansTable)
      .values({
        userId: uid(req),
        name: input.name,
        strategy: input.strategy,
        extraMonthlyPayment: input.extraMonthlyPayment,
        customOrder: input.customOrder ?? [],
      })
      .returning();

    appendAuditEvent({
      userId: uid(req), action: "create", entityType: "debt_payoff_plan", entityId: plan.id,
      requestId: requestId(req), source: "api",
    }).catch(() => {});

    return res.status(201).json({ plan });
  } catch (error) {
    return handleError(res, error);
  }
});

// GET /api/debt-payoff/plans/:id — returns plan + live recalculated schedule
router.get("/debt-payoff/plans/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = uid(req);
    const [plan] = await db
      .select()
      .from(debtPayoffPlansTable)
      .where(
        and(
          eq(debtPayoffPlansTable.id, String(req.params["id"])),
          eq(debtPayoffPlansTable.userId, userId),
          ne(debtPayoffPlansTable.status, "archived"),
        ),
      )
      .limit(1);

    if (!plan) return res.status(404).json({ error: "Plan not found." });

    const debts = await loadUserDebts(userId);
    const schedule = calculatePayoffSchedule({
      debts: debts.map((d) => ({
        id: d.id,
        name: d.name,
        balance: d.balance,
        interestRate: d.interestRate,
        minimumPayment: d.minimumPayment,
        creditLimit: d.creditLimit ?? undefined,
        isRevolving: d.isRevolving,
      })),
      strategy: plan.strategy as any,
      extraMonthlyPayment: plan.extraMonthlyPayment,
      customOrder: plan.customOrder as string[],
    });

    return res.json({ plan, schedule });
  } catch (error) {
    return handleError(res, error);
  }
});

// PATCH /api/debt-payoff/plans/:id
router.patch("/debt-payoff/plans/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = uid(req);
    const input = UpdatePlanSchema.parse(req.body);

    const [plan] = await db
      .update(debtPayoffPlansTable)
      .set({ ...input, updatedAt: new Date() })
      .where(
        and(
          eq(debtPayoffPlansTable.id, String(req.params["id"])),
          eq(debtPayoffPlansTable.userId, userId),
          ne(debtPayoffPlansTable.status, "archived"),
        ),
      )
      .returning();

    if (!plan) return res.status(404).json({ error: "Plan not found." });

    // Return with freshly-recalculated schedule
    const debts = await loadUserDebts(userId);
    const schedule = calculatePayoffSchedule({
      debts: debts.map((d) => ({
        id: d.id, name: d.name, balance: d.balance, interestRate: d.interestRate,
        minimumPayment: d.minimumPayment, creditLimit: d.creditLimit ?? undefined,
        isRevolving: d.isRevolving,
      })),
      strategy: plan.strategy as any,
      extraMonthlyPayment: plan.extraMonthlyPayment,
      customOrder: plan.customOrder as string[],
    });

    appendAuditEvent({
      userId, action: "update", entityType: "debt_payoff_plan", entityId: plan.id,
      requestId: requestId(req), source: "api",
    }).catch(() => {});

    return res.json({ plan, schedule });
  } catch (error) {
    return handleError(res, error);
  }
});

// DELETE /api/debt-payoff/plans/:id — archive
router.delete("/debt-payoff/plans/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const [plan] = await db
      .update(debtPayoffPlansTable)
      .set({ status: "archived", updatedAt: new Date() })
      .where(
        and(
          eq(debtPayoffPlansTable.id, String(req.params["id"])),
          eq(debtPayoffPlansTable.userId, uid(req)),
        ),
      )
      .returning({ id: debtPayoffPlansTable.id });

    if (!plan) return res.status(404).json({ error: "Plan not found." });

    appendAuditEvent({
      userId: uid(req), action: "delete", entityType: "debt_payoff_plan", entityId: String(req.params["id"]),
      requestId: requestId(req), source: "api",
    }).catch(() => {});

    return res.json({ archived: true });
  } catch (error) {
    return handleError(res, error);
  }
});

export default router;
