/**
 * Weekly Snapshot routes.
 *
 * GET /api/weekly-snapshot/current  — compute this week's summary + save for history.
 * GET /api/weekly-snapshot/history  — past weekly snapshots.
 */

import { Router, type IRouter } from "express";
import type { AuthenticatedRequest } from "../middlewares/auth.js";
import { requireAuthenticatedUser } from "../middlewares/auth.js";
import { ensureUser, getFinancialSnapshot } from "../lib/financial-repository.js";
import { computeHealthScore } from "../lib/health-score-engine.js";
import { computeCurrentWeekSnapshot, listWeeklySnapshots } from "../lib/weekly-snapshot-service.js";
import { logger } from "../lib/logger.js";

// Reuse same helper as health-score route to build engine input
import { buildHealthScoreInputFromSnapshot } from "../lib/health-score-input-builder.js";

const router: IRouter = Router();
router.use("/weekly-snapshot", requireAuthenticatedUser);

router.get("/weekly-snapshot/current", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) { res.status(401).json({ error: "Authentication required." }); return; }

    await ensureUser({ userId });
    const snapshot = await getFinancialSnapshot(userId);
    const healthInput = buildHealthScoreInputFromSnapshot(snapshot);
    const healthResult = computeHealthScore(healthInput);

    const weekly = await computeCurrentWeekSnapshot(userId, healthResult.score ?? null);

    res.json({
      generatedAt: new Date().toISOString(),
      current: weekly,
      healthScore: healthResult.score,
      healthConfidence: healthResult.confidence,
    });
  } catch (error) {
    logger.error({ err: error }, "weekly snapshot current failed");
    res.status(500).json({
      stage: "weekly_snapshot",
      error: "Your weekly snapshot could not be generated right now.",
    });
  }
});

router.get("/weekly-snapshot/history", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) { res.status(401).json({ error: "Authentication required." }); return; }

    const history = await listWeeklySnapshots(userId, 12);
    res.json({ history });
  } catch (error) {
    logger.error({ err: error }, "weekly snapshot history failed");
    res.status(500).json({
      stage: "weekly_snapshot_history",
      error: "Your snapshot history could not be loaded right now.",
    });
  }
});

export default router;
