/**
 * Repository for financial goals — full CRUD with soft-delete and ownership
 * enforcement. Every query filters by userId so no cross-user leakage is possible.
 */

import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  financialGoalsTable,
  insertFinancialGoalSchema,
} from "@workspace/db";
import type { FinancialGoalRecord } from "@workspace/db";
import { z } from "zod";

export type { FinancialGoalRecord };

export const GoalCategory = z.enum([
  "emergency_fund",
  "savings",
  "debt_payoff",
  "investment",
  "purchase",
  "other",
]);

export const GoalStatus = z.enum(["active", "completed", "paused", "archived"]);

export const CreateGoalSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  category: GoalCategory.default("savings"),
  targetAmount: z.number().min(0).max(10_000_000),
  currentAmount: z.number().min(0).max(10_000_000).default(0),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be YYYY-MM-DD")
    .optional(),
  status: GoalStatus.default("active"),
});

export const UpdateGoalSchema = CreateGoalSchema.partial();
export const ContributeSchema = z.object({ amount: z.number() });

export type CreateGoalInput = z.infer<typeof CreateGoalSchema>;
export type UpdateGoalInput = z.infer<typeof UpdateGoalSchema>;

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function listGoals(userId: string): Promise<FinancialGoalRecord[]> {
  return db
    .select()
    .from(financialGoalsTable)
    .where(
      and(eq(financialGoalsTable.userId, userId), isNull(financialGoalsTable.deletedAt)),
    )
    .orderBy(financialGoalsTable.createdAt);
}

export async function getGoalById(
  userId: string,
  goalId: string,
): Promise<FinancialGoalRecord | null> {
  const [row] = await db
    .select()
    .from(financialGoalsTable)
    .where(
      and(
        eq(financialGoalsTable.id, goalId),
        eq(financialGoalsTable.userId, userId),
        isNull(financialGoalsTable.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createGoal(
  userId: string,
  input: CreateGoalInput,
): Promise<FinancialGoalRecord> {
  const [row] = await db
    .insert(financialGoalsTable)
    .values({ ...input, userId })
    .returning();
  if (!row) throw new Error("Goal insert returned no row.");
  return row;
}

export async function updateGoal(
  userId: string,
  goalId: string,
  input: UpdateGoalInput,
): Promise<FinancialGoalRecord | null> {
  const [row] = await db
    .update(financialGoalsTable)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(
        eq(financialGoalsTable.id, goalId),
        eq(financialGoalsTable.userId, userId),
        isNull(financialGoalsTable.deletedAt),
      ),
    )
    .returning();
  return row ?? null;
}

/** Add (positive) or subtract (negative) from current_amount, clamped to [0, target]. */
export async function contributeToGoal(
  userId: string,
  goalId: string,
  amount: number,
): Promise<FinancialGoalRecord | null> {
  const existing = await getGoalById(userId, goalId);
  if (!existing) return null;

  const next = Math.max(0, existing.currentAmount + amount);
  const capped = Math.min(next, existing.targetAmount);
  const newStatus =
    capped >= existing.targetAmount && existing.targetAmount > 0 ? "completed" : existing.status;

  const [row] = await db
    .update(financialGoalsTable)
    .set({ currentAmount: capped, status: newStatus, updatedAt: new Date() })
    .where(
      and(
        eq(financialGoalsTable.id, goalId),
        eq(financialGoalsTable.userId, userId),
        isNull(financialGoalsTable.deletedAt),
      ),
    )
    .returning();
  return row ?? null;
}

export async function archiveGoal(
  userId: string,
  goalId: string,
): Promise<boolean> {
  const [row] = await db
    .update(financialGoalsTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(financialGoalsTable.id, goalId),
        eq(financialGoalsTable.userId, userId),
        isNull(financialGoalsTable.deletedAt),
      ),
    )
    .returning({ id: financialGoalsTable.id });
  return !!row;
}

/** Return (or create) the single emergency-fund goal for a user. */
export async function getOrCreateEmergencyFundGoal(
  userId: string,
  suggestedTarget: number,
): Promise<FinancialGoalRecord> {
  const [existing] = await db
    .select()
    .from(financialGoalsTable)
    .where(
      and(
        eq(financialGoalsTable.userId, userId),
        eq(financialGoalsTable.category, "emergency_fund"),
        isNull(financialGoalsTable.deletedAt),
      ),
    )
    .limit(1);

  if (existing) return existing;

  return createGoal(userId, {
    title: "Emergency Fund",
    description: "3–6 months of living expenses saved for unexpected events.",
    category: "emergency_fund",
    targetAmount: suggestedTarget,
    currentAmount: 0,
    status: "active",
  });
}
