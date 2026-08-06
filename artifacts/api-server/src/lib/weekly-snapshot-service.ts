/**
 * Weekly Financial Snapshot Service
 *
 * Generates natural-language weekly summary sentences from timeline events,
 * saves them to financial_snapshots for history, and retrieves past weeks.
 */

import { pool } from "@workspace/db";
import { getWeeklyTrends, type MonthlyTrends } from "./timeline-repository.js";
import { logger } from "./logger.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type WeeklySnapshotSummary = {
  weekStart: string; // ISO date string (Monday)
  weekEnd: string;   // ISO date string (Sunday)
  sentences: string[];
  trends: MonthlyTrends;
  capturedAt: string;
};

export type StoredWeeklySnapshot = {
  id: string;
  weekStart: string;
  weekEnd: string;
  sentences: string[];
  trends: MonthlyTrends;
  capturedAt: string;
};

// ─── Sentence generation ──────────────────────────────────────────────────────

function fmt(amount: number): string {
  return `$${Math.abs(Math.round(amount)).toLocaleString("en-US")}`;
}

export function generateSentences(trends: MonthlyTrends, healthScoreDelta: number | null): string[] {
  const lines: string[] = [];

  // Net worth — first and most important
  if (trends.netWorth !== null && trends.netWorth !== 0) {
    lines.push(
      trends.netWorth > 0
        ? `Net worth increased ${fmt(trends.netWorth)} this week.`
        : `Net worth decreased ${fmt(trends.netWorth)} this week.`,
    );
  }

  // Cash
  if (trends.cash !== null && trends.cash !== 0) {
    lines.push(
      trends.cash > 0
        ? `Cash increased ${fmt(trends.cash)}.`
        : `Cash decreased ${fmt(trends.cash)}.`,
    );
  }

  // Debt (decrease = good)
  if (trends.debt !== null && trends.debt !== 0) {
    lines.push(
      trends.debt < 0
        ? `Debt decreased ${fmt(trends.debt)}.`
        : `Debt increased ${fmt(trends.debt)}.`,
    );
  }

  // Investments
  if (trends.investments !== null && trends.investments !== 0) {
    lines.push(
      trends.investments > 0
        ? `Investments gained ${fmt(trends.investments)}.`
        : `Investments dropped ${fmt(trends.investments)}.`,
    );
  }

  // Retirement
  if (trends.retirement !== null && trends.retirement !== 0) {
    lines.push(
      trends.retirement > 0
        ? `Retirement savings grew ${fmt(trends.retirement)}.`
        : `Retirement balance dropped ${fmt(trends.retirement)}.`,
    );
  }

  // Tax estimate
  if (trends.estimatedTax !== null && trends.estimatedTax !== 0) {
    lines.push(
      trends.estimatedTax > 0
        ? `Estimated refund increased ${fmt(trends.estimatedTax)}.`
        : `Estimated refund decreased ${fmt(trends.estimatedTax)}.`,
    );
  }

  // Health score
  if (healthScoreDelta !== null && healthScoreDelta !== 0) {
    lines.push(
      healthScoreDelta > 0
        ? `Financial score improved ${Math.abs(healthScoreDelta)} point${Math.abs(healthScoreDelta) === 1 ? "" : "s"}.`
        : `Financial score dropped ${Math.abs(healthScoreDelta)} point${Math.abs(healthScoreDelta) === 1 ? "" : "s"}.`,
    );
  }

  // Quiet week
  if (lines.length === 0) {
    lines.push("No financial changes recorded this week.");
  }

  return lines;
}

// ─── Week boundary helpers ────────────────────────────────────────────────────

/** Returns Monday of the current week (UTC). */
function currentWeekStart(): Date {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon
  const diff = day === 0 ? -6 : 1 - day; // distance to Monday
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));
  return monday;
}

/** Returns Sunday 23:59:59 of the current week (UTC). */
function currentWeekEnd(): Date {
  const start = currentWeekStart();
  return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function getPreviousHealthScore(userId: string): Promise<number | null> {
  try {
    const result = await pool.query<{ health_score: string | null }>(
      `SELECT health_score FROM financial_snapshots
       WHERE clerk_user_id = $1 AND health_score IS NOT NULL AND source = 'health_score'
       ORDER BY captured_at DESC LIMIT 1`,
      [userId],
    );
    const raw = result.rows[0]?.health_score;
    return raw !== null && raw !== undefined ? parseInt(raw, 10) : null;
  } catch {
    return null;
  }
}

async function saveWeeklySnapshot(
  userId: string,
  weekStart: Date,
  weekEnd: Date,
  sentences: string[],
  trends: MonthlyTrends,
): Promise<void> {
  try {
    const weekKey = weekStart.toISOString().slice(0, 10);
    // Use idempotent insert — one snapshot per user per week
    await pool.query(
      `INSERT INTO financial_snapshots
       (clerk_user_id, source, cash, monthly_take_home, monthly_expenses, total_debt,
        high_interest_debt, investments, retirement, credit_utilization, net_worth, metadata)
       VALUES ($1, 'weekly_snapshot', $2, 0, 0, $3, 0, $4, $5, 0, $6, $7::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        userId,
        trends.cash ?? 0,
        Math.abs(trends.debt ?? 0),
        trends.investments ?? 0,
        trends.retirement ?? 0,
        (trends.cash ?? 0) + (trends.investments ?? 0) + (trends.retirement ?? 0) - Math.abs(trends.debt ?? 0),
        JSON.stringify({
          weekStart: weekStart.toISOString(),
          weekEnd: weekEnd.toISOString(),
          weekKey,
          sentences,
          trends,
        }),
      ],
    );
  } catch (err) {
    logger.warn({ err }, "weekly snapshot save failed — continuing");
  }
}

// ─── Main exports ─────────────────────────────────────────────────────────────

export async function computeCurrentWeekSnapshot(
  userId: string,
  currentHealthScore: number | null,
): Promise<WeeklySnapshotSummary> {
  const [trends, prevScore] = await Promise.all([
    getWeeklyTrends(userId),
    getPreviousHealthScore(userId),
  ]);

  const healthScoreDelta =
    currentHealthScore !== null && prevScore !== null ? currentHealthScore - prevScore : null;

  const sentences = generateSentences(trends, healthScoreDelta);
  const weekStart = currentWeekStart();
  const weekEnd = currentWeekEnd();

  // Fire-and-forget save
  void saveWeeklySnapshot(userId, weekStart, weekEnd, sentences, trends);

  return {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    sentences,
    trends,
    capturedAt: new Date().toISOString(),
  };
}

export async function listWeeklySnapshots(userId: string, limit = 12): Promise<StoredWeeklySnapshot[]> {
  try {
    const result = await pool.query<{
      id: string;
      captured_at: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id, captured_at, metadata
       FROM financial_snapshots
       WHERE clerk_user_id = $1 AND source = 'weekly_snapshot'
       ORDER BY captured_at DESC
       LIMIT $2`,
      [userId, Math.min(52, Math.max(1, limit))],
    );

    return result.rows
      .map((row) => {
        const m = row.metadata ?? {};
        return {
          id: row.id,
          weekStart: (m.weekStart as string | undefined) ?? row.captured_at,
          weekEnd: (m.weekEnd as string | undefined) ?? row.captured_at,
          sentences: Array.isArray(m.sentences) ? (m.sentences as string[]) : [],
          trends: (m.trends as MonthlyTrends | undefined) ?? {
            cash: null, debt: null, investments: null,
            retirement: null, netWorth: null, estimatedTax: null,
          },
          capturedAt: row.captured_at,
        };
      });
  } catch (err) {
    logger.error({ err }, "weekly snapshot list failed");
    return [];
  }
}
