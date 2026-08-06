/**
 * Health Score routes.
 *
 * GET /api/health-score/detail — compute and return the full 10-category breakdown
 *   (also persists a snapshot for history).
 * GET /api/health-score/history — monthly score history from saved snapshots.
 */

import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import type { AuthenticatedRequest } from "../middlewares/auth.js";
import { requireAuthenticatedUser } from "../middlewares/auth.js";
import { ensureUser, getFinancialSnapshot } from "../lib/financial-repository.js";
import { computeHealthScore, type HealthScoreInput } from "../lib/health-score-engine.js";
import { buildHealthScoreInputFromSnapshot } from "../lib/health-score-input-builder.js";
import { getLatestTaxEstimateForAI } from "../lib/ai-tax-context.js";
import { healthScoreCache } from "../lib/route-cache.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.use("/health-score", requireAuthenticatedUser);


async function saveHealthSnapshot(
  userId: string,
  input: HealthScoreInput,
  score: number | null,
  confidence: number,
) {
  try {
    const cash = input.cash ?? 0;
    const investments = input.investments ?? 0;
    const retirement = input.retirement ?? 0;
    const totalDebt = input.totalDebt ?? 0;
    const netWorth = cash + investments + retirement - totalDebt;

    await pool.query(
      `INSERT INTO financial_snapshots
       (clerk_user_id, source, cash, monthly_take_home, monthly_expenses, total_debt,
        high_interest_debt, investments, retirement, credit_utilization, health_score, net_worth, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [
        userId,
        "health_score",
        cash,
        input.monthlyNetIncome ?? 0,
        (input.monthlyBills ?? 0) + (input.monthlyDebtPayments ?? 0),
        totalDebt,
        input.highInterestDebt ?? 0,
        investments,
        retirement,
        input.creditUtilization ?? 0,
        score ?? null,
        netWorth,
        JSON.stringify({ confidence, paystubCount: input.paystubCount }),
      ],
    );
  } catch (err) {
    logger.warn({ err }, "health score snapshot save failed — continuing");
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/health-score/detail", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) { res.status(401).json({ error: "Authentication required." }); return; }

    // Fast path: serve from 60-second cache
    const cached = healthScoreCache.get(userId);
    if (cached) {
      res.setHeader("Cache-Control", "private, max-age=60");
      res.json(cached);
      return;
    }

    await ensureUser({ userId });
    const [snapshot, taxEstimate] = await Promise.all([
      getFinancialSnapshot(userId),
      getLatestTaxEstimateForAI(userId).catch(() => null),
    ]);
    const base = buildHealthScoreInputFromSnapshot(snapshot);
    const input: HealthScoreInput = {
      ...base,
      hasTaxEstimate: taxEstimate !== null,
      taxEstimateAgeDays: taxEstimate?.updatedAt != null
        ? Math.floor((Date.now() - new Date(taxEstimate.updatedAt).getTime()) / 86_400_000)
        : null,
    };
    const result = computeHealthScore(input);

    // Persist snapshot in background
    void saveHealthSnapshot(userId, input, result.score, result.confidence);

    const payload = {
      generatedAt: new Date().toISOString(),
      healthScore: result,
    };
    healthScoreCache.set(userId, payload);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.json(payload);
  } catch (error) {
    logger.error({ err: error }, "health score detail failed");
    res.status(500).json({
      stage: "health_score",
      error: "Your health score could not be calculated right now.",
    });
  }
});

router.get("/health-score/history", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) { res.status(401).json({ error: "Authentication required." }); return; }

    const result = await pool.query<{
      month: string;
      score: string | null;
      confidence: string | null;
      captured_at: string;
    }>(
      `SELECT
         to_char(date_trunc('month', captured_at), 'YYYY-MM') AS month,
         ROUND(AVG(health_score)) AS score,
         ROUND(AVG((metadata->>'confidence')::numeric)) AS confidence,
         MAX(captured_at) AS captured_at
       FROM financial_snapshots
       WHERE clerk_user_id = $1
         AND health_score IS NOT NULL
         AND source = 'health_score'
       GROUP BY date_trunc('month', captured_at)
       ORDER BY date_trunc('month', captured_at) DESC
       LIMIT 12`,
      [userId],
    );

    const history = result.rows.map((row) => ({
      month: row.month,
      score: row.score !== null ? parseInt(row.score, 10) : null,
      confidence: row.confidence !== null ? parseInt(row.confidence, 10) : null,
      capturedAt: row.captured_at,
    }));

    res.json({ history });
  } catch (error) {
    logger.error({ err: error }, "health score history failed");
    res.status(500).json({
      stage: "health_score_history",
      error: "Health score history could not be loaded right now.",
    });
  }
});

export default router;
