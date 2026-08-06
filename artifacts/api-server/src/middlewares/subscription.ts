/**
 * Subscription / entitlement middleware.
 *
 * checkScanEntitlement — must be placed AFTER requireAuthenticatedUser in the
 *   scan route's middleware chain. Records usage via res.on('finish') so the
 *   scan handler needs no changes.
 *
 * requirePlan — generic guard for premium routes. Returns 402 with an
 *   upgrade_url when the user's effective plan is below the required tier.
 */

import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth.js";
import {
  getEffectivePlan,
  getScanUsageForPeriod,
  recordScanUsage,
  currentPeriodKey,
} from "../lib/subscription-repository.js";
import { PLAN_DEFINITIONS, type PlanId } from "../lib/entitlements.js";
import { logger } from "../lib/logger.js";

// ─── Plan rank for comparison ─────────────────────────────────────────────────

const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, business: 2 };

export function planMeetsMinimum(effectivePlan: PlanId, minPlan: PlanId): boolean {
  return PLAN_RANK[effectivePlan] >= PLAN_RANK[minPlan];
}

// ─── Scan entitlement middleware ──────────────────────────────────────────────

export async function checkScanEntitlement(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.authenticatedUserId;
  if (!userId) {
    res.status(401).json({ stage: "authentication", error: "Authentication required." });
    return;
  }

  try {
    const { effectivePlan, status } = await getEffectivePlan(userId);

    // past_due/unpaid: restrict to free-tier limits
    const planForLimits: PlanId =
      status === "past_due" || status === "unpaid" ? "free" : effectivePlan;

    const periodKey = currentPeriodKey();
    const used = await getScanUsageForPeriod(userId, periodKey);
    const limit = PLAN_DEFINITIONS[planForLimits].limits.document_scan;

    if (limit !== null && used >= limit) {
      res.status(402).json({
        stage: "subscription_limit",
        error: `You've used all ${limit} document scans for this billing period.`,
        plan: effectivePlan,
        limit,
        used,
        upgradeUrl: "/pricing",
        resetAt: `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 2).padStart(2, "0")}-01`,
      });
      return;
    }

    // Record usage after a successful (2xx) response
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void recordScanUsage(userId, periodKey);
      }
    });

    next();
  } catch (err) {
    // Non-fatal: log and allow the scan to proceed on DB error
    logger.warn({ err, userId }, "checkScanEntitlement failed — allowing scan through");
    next();
  }
}

// ─── Generic plan guard ───────────────────────────────────────────────────────

export function requirePlan(minPlan: PlanId) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.authenticatedUserId;
    if (!userId) {
      res.status(401).json({ stage: "authentication", error: "Authentication required." });
      return;
    }

    try {
      const { effectivePlan, status } = await getEffectivePlan(userId);

      // Billing warning: past_due/unpaid restricts to free tier
      const planForAccess: PlanId =
        status === "past_due" || status === "unpaid" ? "free" : effectivePlan;

      if (!planMeetsMinimum(planForAccess, minPlan)) {
        res.status(402).json({
          stage: "plan_required",
          error: `This feature requires the ${minPlan} plan or higher.`,
          currentPlan: effectivePlan,
          requiredPlan: minPlan,
          upgradeUrl: "/pricing",
        });
        return;
      }

      next();
    } catch (err) {
      logger.warn({ err, userId }, "requirePlan check failed");
      res.status(500).json({ stage: "plan_check", error: "Unable to verify your plan." });
    }
  };
}
