/**
 * Goals API regression tests.
 *
 * Tests the goals repository functions in isolation using an in-memory-like
 * approach: each test creates its own user ID so state cannot bleed between tests.
 *
 * Coverage:
 *  - Create goal (all categories)
 *  - List goals (only non-deleted)
 *  - Get goal by ID (ownership enforced)
 *  - Update goal (partial merge, ownership enforced)
 *  - Contribute to goal (clamping, auto-completion)
 *  - Archive goal (soft-delete)
 *  - Emergency-fund goal idempotency
 *  - Negative: cross-user access blocked
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createGoal,
  listGoals,
  getGoalById,
  updateGoal,
  contributeToGoal,
  archiveGoal,
  getOrCreateEmergencyFundGoal,
} from "../lib/goals-repository.js";
import { db, usersTable } from "@workspace/db";

const uid = (suffix: string) => `goals-test-user-${suffix}-${Date.now()}`;

async function ensureUser(userId: string) {
  await db.insert(usersTable).values({ id: userId }).onConflictDoNothing();
}

describe("goals-regression", () => {
  const U1 = uid("u1");
  const U2 = uid("u2");

  before(async () => {
    await ensureUser(U1);
    await ensureUser(U2);
  });

  // ── CREATE ────────────────────────────────────────────────────────────────

  test("creates a savings goal", async () => {
    const goal = await createGoal(U1, {
      title: "New truck fund",
      category: "savings",
      targetAmount: 10_000,
    });
    assert.equal(goal.title, "New truck fund");
    assert.equal(goal.category, "savings");
    assert.equal(goal.currentAmount, 0);
    assert.equal(goal.status, "active");
    assert.equal(goal.userId, U1);
  });

  test("creates an emergency_fund goal", async () => {
    const goal = await createGoal(U1, {
      title: "3-month cushion",
      category: "emergency_fund",
      targetAmount: 6_000,
      currentAmount: 1_200,
    });
    assert.equal(goal.category, "emergency_fund");
    assert.equal(goal.currentAmount, 1_200);
  });

  test("creates goal with targetDate", async () => {
    const goal = await createGoal(U1, {
      title: "Christmas savings",
      category: "purchase",
      targetAmount: 500,
      targetDate: "2026-12-01",
    });
    assert.equal(goal.targetDate, "2026-12-01");
  });

  // ── LIST ─────────────────────────────────────────────────────────────────

  test("lists only active (non-deleted) goals for the user", async () => {
    const userA = uid("list-a");
    await ensureUser(userA);
    const g1 = await createGoal(userA, { title: "G1", category: "savings", targetAmount: 100 });
    const g2 = await createGoal(userA, { title: "G2", category: "savings", targetAmount: 200 });
    await archiveGoal(userA, g2.id);

    const goals = await listGoals(userA);
    assert.equal(goals.length, 1);
    assert.equal(goals[0].id, g1.id);
  });

  test("listGoals returns empty array when user has no goals", async () => {
    const emptyUser = uid("empty");
    await ensureUser(emptyUser);
    const goals = await listGoals(emptyUser);
    assert.deepEqual(goals, []);
  });

  // ── GET BY ID ─────────────────────────────────────────────────────────────

  test("getGoalById returns null for a different user's goal", async () => {
    const goal = await createGoal(U1, { title: "Private goal", category: "savings", targetAmount: 50 });
    const result = await getGoalById(U2, goal.id);
    assert.equal(result, null, "Cross-user read must return null");
  });

  test("getGoalById returns null for archived goal", async () => {
    const goal = await createGoal(U1, { title: "Archived goal", category: "savings", targetAmount: 100 });
    await archiveGoal(U1, goal.id);
    const result = await getGoalById(U1, goal.id);
    assert.equal(result, null);
  });

  // ── UPDATE ────────────────────────────────────────────────────────────────

  test("updateGoal partially updates fields", async () => {
    const goal = await createGoal(U1, { title: "Old title", category: "savings", targetAmount: 1_000 });
    const updated = await updateGoal(U1, goal.id, { title: "New title", targetAmount: 2_000 });
    assert.ok(updated);
    assert.equal(updated.title, "New title");
    assert.equal(updated.targetAmount, 2_000);
    assert.equal(updated.category, "savings"); // unchanged
  });

  test("updateGoal returns null when accessing another user's goal", async () => {
    const goal = await createGoal(U1, { title: "My goal", category: "savings", targetAmount: 100 });
    const result = await updateGoal(U2, goal.id, { title: "Hijacked" });
    assert.equal(result, null);
  });

  test("updateGoal can pause and resume a goal", async () => {
    const goal = await createGoal(U1, { title: "Pausable", category: "savings", targetAmount: 100 });
    const paused = await updateGoal(U1, goal.id, { status: "paused" });
    assert.equal(paused?.status, "paused");
    const resumed = await updateGoal(U1, goal.id, { status: "active" });
    assert.equal(resumed?.status, "active");
  });

  // ── CONTRIBUTE ────────────────────────────────────────────────────────────

  test("contributeToGoal adds to currentAmount", async () => {
    const goal = await createGoal(U1, { title: "Contributions", category: "savings", targetAmount: 1_000 });
    const updated = await contributeToGoal(U1, goal.id, 250);
    assert.ok(updated);
    assert.equal(updated.currentAmount, 250);
  });

  test("contributeToGoal caps at targetAmount and marks completed", async () => {
    const goal = await createGoal(U1, {
      title: "Almost there",
      category: "savings",
      targetAmount: 500,
      currentAmount: 450,
    });
    const updated = await contributeToGoal(U1, goal.id, 200); // would bring to 650
    assert.ok(updated);
    assert.equal(updated.currentAmount, 500, "Should cap at targetAmount");
    assert.equal(updated.status, "completed");
  });

  test("contributeToGoal clamps at 0 on negative contribution", async () => {
    const goal = await createGoal(U1, {
      title: "Withdrawal test",
      category: "savings",
      targetAmount: 1_000,
      currentAmount: 100,
    });
    const updated = await contributeToGoal(U1, goal.id, -500); // would bring to -400
    assert.ok(updated);
    assert.equal(updated.currentAmount, 0, "Should not go below 0");
  });

  // ── ARCHIVE ───────────────────────────────────────────────────────────────

  test("archiveGoal soft-deletes the goal", async () => {
    const goal = await createGoal(U1, { title: "To archive", category: "savings", targetAmount: 100 });
    const result = await archiveGoal(U1, goal.id);
    assert.equal(result, true);
    const fetched = await getGoalById(U1, goal.id);
    assert.equal(fetched, null);
  });

  test("archiveGoal returns false for another user's goal", async () => {
    const goal = await createGoal(U1, { title: "Not yours", category: "savings", targetAmount: 100 });
    const result = await archiveGoal(U2, goal.id);
    assert.equal(result, false);
  });

  // ── EMERGENCY FUND IDEMPOTENCY ────────────────────────────────────────────

  test("getOrCreateEmergencyFundGoal returns same goal on repeated calls", async () => {
    const efUser = uid("ef");
    await ensureUser(efUser);
    const first = await getOrCreateEmergencyFundGoal(efUser, 5_000);
    const second = await getOrCreateEmergencyFundGoal(efUser, 8_000);
    assert.equal(first.id, second.id, "Must return same goal, not a new one");
    assert.equal(first.category, "emergency_fund");
  });
});
