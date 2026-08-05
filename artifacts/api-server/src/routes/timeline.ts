/**
 * Financial Timeline API routes.
 *
 * GET /api/timeline/summary — authenticated; returns recent events + monthly trends.
 * Triggers a lazy backfill of existing records on first call (idempotent).
 */

import { Router, type IRouter } from "express";
import type { AuthenticatedRequest } from "../middlewares/auth.js";
import { requireAuthenticatedUser } from "../middlewares/auth.js";
import { ensureUser, getFinancialSnapshot } from "../lib/financial-repository.js";
import {
  listTimelineEvents,
  getMonthlyTrends,
  backfillTimeline,
} from "../lib/timeline-repository.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.use("/timeline", requireAuthenticatedUser);

router.get("/timeline/summary", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    await ensureUser({ userId });

    // Lazy backfill — creates events for any existing records that have none.
    // Errors are logged but never fail the request.
    try {
      const snapshot = await getFinancialSnapshot(userId);
      await backfillTimeline(userId, snapshot);
    } catch (backfillErr) {
      logger.warn({ err: backfillErr, userId }, "timeline backfill failed, continuing");
    }

    const [events, monthlyTrends] = await Promise.all([
      listTimelineEvents(userId, { limit: 50 }),
      getMonthlyTrends(userId),
    ]);

    res.json({
      generatedAt: new Date().toISOString(),
      events,
      monthlyTrends,
    });
  } catch (error) {
    logger.error({ err: error }, "timeline summary request failed");
    res.status(500).json({
      stage: "timeline",
      error: "Your financial timeline could not be loaded right now.",
    });
  }
});

export default router;
