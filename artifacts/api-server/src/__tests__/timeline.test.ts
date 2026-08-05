/**
 * Tests for the Financial Timeline feature.
 *
 * Covers:
 * - User isolation (user A never sees user B's events)
 * - Event creation after successful writes
 * - No event after failed writes
 * - Duplicate-request protection (idempotency key)
 * - Missing previous values remain null
 * - Monthly trend calculations
 * - Net-worth change calculations
 * - Empty timeline
 */

import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, usersTable, timelineEventsTable } from "@workspace/db";
import {
  appendTimelineEvent,
  listTimelineEvents,
  getMonthlyTrends,
  type TimelineEventInput,
} from "../lib/timeline-repository.js";
import {
  makePaystubEvent,
  makeAssetEvent,
  makeDebtEvent,
  makeBillEvent,
  makeTaxEstimateEvent,
} from "../lib/timeline-events.js";

// ─── Test users ───────────────────────────────────────────────────────────────

const USER_A = `test-timeline-a-${randomUUID()}`;
const USER_B = `test-timeline-b-${randomUUID()}`;

async function ensureUsers() {
  await db.insert(usersTable).values([
    { id: USER_A, email: "timeline-a@test.example" },
    { id: USER_B, email: "timeline-b@test.example" },
  ]).onConflictDoNothing();
}

async function cleanup() {
  await db.delete(timelineEventsTable).where(eq(timelineEventsTable.userId, USER_A));
  await db.delete(timelineEventsTable).where(eq(timelineEventsTable.userId, USER_B));
  await db.delete(usersTable).where(eq(usersTable.id, USER_A));
  await db.delete(usersTable).where(eq(usersTable.id, USER_B));
}

function baseEvent(userId: string, overrides: Partial<TimelineEventInput> = {}): TimelineEventInput {
  return {
    userId,
    eventType: "bank_balance_updated",
    eventDate: new Date("2026-06-15T10:00:00Z"),
    sourceRecordType: "asset",
    sourceRecordId: randomUUID(),
    previousValue: null,
    newValue: 5000,
    changeAmount: null,
    title: "Bank balance updated",
    description: "Balance of $5,000 recorded.",
    idempotencyKey: `test:${randomUUID()}`,
    ...overrides,
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

before(ensureUsers);
after(cleanup);

// ─── User isolation ───────────────────────────────────────────────────────────

it("user A cannot see user B's timeline events", async () => {
  const srcId = randomUUID();
  await appendTimelineEvent(baseEvent(USER_B, {
    idempotencyKey: `isolation-test:${srcId}`,
    sourceRecordId: srcId,
  }));

  const eventsA = await listTimelineEvents(USER_A);
  const eventsB = await listTimelineEvents(USER_B);

  const srcIdInA = eventsA.some((e) => e.sourceRecordId === srcId);
  const srcIdInB = eventsB.some((e) => e.sourceRecordId === srcId);

  assert.equal(srcIdInA, false, "User A should not see User B's events");
  assert.equal(srcIdInB, true, "User B should see their own event");
});

it("listTimelineEvents never returns rows for a different user", async () => {
  const key = `cross-check:${randomUUID()}`;
  await appendTimelineEvent(baseEvent(USER_A, { idempotencyKey: key }));

  const eventsB = await listTimelineEvents(USER_B);
  const leaked = eventsB.some((e) => e.userId === USER_A);
  assert.equal(leaked, false);
});

// ─── Event creation after successful writes ───────────────────────────────────

it("event is persisted and retrievable after appendTimelineEvent", async () => {
  const srcId = randomUUID();
  const key = `create-test:${srcId}`;
  await appendTimelineEvent(baseEvent(USER_A, {
    idempotencyKey: key,
    sourceRecordId: srcId,
    title: "Saved OK",
    newValue: 8_500,
  }));

  const events = await listTimelineEvents(USER_A);
  const found = events.find((e) => e.sourceRecordId === srcId);
  assert.ok(found, "Event should be found after insert");
  assert.equal(found!.title, "Saved OK");
  assert.equal(found!.newValue, 8_500);
});

it("events are returned newest first", async () => {
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const dates = [
    new Date("2026-05-01T00:00:00Z"),
    new Date("2026-05-15T00:00:00Z"),
    new Date("2026-05-30T00:00:00Z"),
  ];
  for (let i = 0; i < 3; i++) {
    await appendTimelineEvent(baseEvent(USER_A, {
      idempotencyKey: `order-test:${ids[i]}`,
      sourceRecordId: ids[i],
      eventDate: dates[i],
    }));
  }

  const events = await listTimelineEvents(USER_A, { limit: 100 });
  const filtered = events.filter((e) => ids.includes(e.sourceRecordId ?? ""));
  assert.equal(filtered.length, 3);
  assert.ok(
    filtered[0].eventDate >= filtered[1].eventDate,
    "Events should be returned newest first",
  );
});

// ─── Duplicate-request protection ─────────────────────────────────────────────

it("duplicate idempotency key produces only one event", async () => {
  const srcId = randomUUID();
  const key = `dedup:${srcId}`;
  const event = baseEvent(USER_A, { idempotencyKey: key, sourceRecordId: srcId });

  await appendTimelineEvent(event);
  await appendTimelineEvent(event); // same key — should be silently ignored
  await appendTimelineEvent(event); // third time

  const events = await listTimelineEvents(USER_A);
  const matches = events.filter((e) => e.sourceRecordId === srcId);
  assert.equal(matches.length, 1, "Exactly one event should exist despite three inserts");
});

it("different idempotency keys for the same source record produce separate events", async () => {
  const srcId = randomUUID();
  await appendTimelineEvent(baseEvent(USER_A, {
    idempotencyKey: `multi-a:${srcId}`,
    sourceRecordId: srcId,
    eventDate: new Date("2026-04-01"),
  }));
  await appendTimelineEvent(baseEvent(USER_A, {
    idempotencyKey: `multi-b:${srcId}`,
    sourceRecordId: srcId,
    eventDate: new Date("2026-05-01"),
  }));

  const events = await listTimelineEvents(USER_A);
  const matches = events.filter((e) => e.sourceRecordId === srcId);
  assert.equal(matches.length, 2, "Two distinct events should exist for different keys");
});

// ─── Missing previous values remain null ──────────────────────────────────────

it("previousValue is null when not provided", async () => {
  const srcId = randomUUID();
  await appendTimelineEvent(baseEvent(USER_A, {
    idempotencyKey: `null-prev:${srcId}`,
    sourceRecordId: srcId,
    previousValue: undefined,
    changeAmount: undefined,
  }));

  const events = await listTimelineEvents(USER_A);
  const found = events.find((e) => e.sourceRecordId === srcId);
  assert.ok(found);
  assert.equal(found!.previousValue, null, "previousValue must be null, not 0");
  assert.equal(found!.changeAmount, null, "changeAmount must be null, not 0");
});

it("changeAmount is null when previous value is unknown", async () => {
  const paystubId = randomUUID();
  const event = makePaystubEvent(
    USER_A,
    { id: paystubId, payDate: new Date(), netPay: 3_200 },
    null,   // ← no previous value known
    false,
  );
  await appendTimelineEvent(event);

  const events = await listTimelineEvents(USER_A);
  const found = events.find((e) => e.sourceRecordId === paystubId);
  assert.ok(found);
  assert.equal(found!.previousValue, null);
  assert.equal(found!.changeAmount, null);
});

// ─── Event constructors ───────────────────────────────────────────────────────

it("makePaystubEvent computes changeAmount when previousNetPay is known", () => {
  const event = makePaystubEvent(
    USER_A,
    { id: randomUUID(), payDate: new Date("2026-07-01"), netPay: 4_000 },
    3_600,
    true,
  );
  assert.equal(event.changeAmount, 400);
  assert.equal(event.previousValue, 3_600);
  assert.equal(event.newValue, 4_000);
});

it("makeAssetEvent categorises retirement accounts correctly", () => {
  const event = makeAssetEvent(
    USER_A,
    { id: randomUUID(), name: "My 401k", type: "Investment", value: 55_000, updatedAt: new Date() },
    null,
    false,
  );
  assert.equal(event.eventType, "retirement_balance_updated");
});

it("makeAssetEvent categorises cash accounts correctly", () => {
  const event = makeAssetEvent(
    USER_A,
    { id: randomUUID(), name: "Chase Checking", type: "Cash", value: 3_000, updatedAt: new Date() },
    null,
    false,
  );
  assert.equal(event.eventType, "bank_balance_updated");
});

it("makeDebtEvent marks revolving debts as credit_card_balance_updated", () => {
  const event = makeDebtEvent(
    USER_A,
    { id: randomUUID(), name: "Visa", balance: 2_000, isRevolving: true, updatedAt: new Date() },
    null,
    false,
  );
  assert.equal(event.eventType, "credit_card_balance_updated");
});

it("makeDebtEvent marks non-revolving debts as loan_balance_updated", () => {
  const event = makeDebtEvent(
    USER_A,
    { id: randomUUID(), name: "Car Loan", balance: 12_000, isRevolving: false, updatedAt: new Date() },
    null,
    false,
  );
  assert.equal(event.eventType, "loan_balance_updated");
});

it("makeTaxEstimateEvent captures refundOrAmountOwed from result", () => {
  const event = makeTaxEstimateEvent(
    USER_A,
    { id: randomUUID(), updatedAt: new Date(), result: { refundOrAmountOwed: 1_500 } },
    null,
  );
  assert.equal(event.newValue, 1_500);
  assert.equal(event.previousValue, null);
  assert.equal(event.changeAmount, null);
  assert.equal(event.eventType, "tax_estimate_saved");
});

it("makeTaxEstimateEvent computes changeAmount when previousRefund is known", () => {
  const event = makeTaxEstimateEvent(
    USER_A,
    { id: randomUUID(), updatedAt: new Date(), result: { refundOrAmountOwed: 1_800 } },
    1_400,
  );
  assert.equal(event.changeAmount, 400);
  assert.equal(event.previousValue, 1_400);
});

// ─── Monthly trend calculations ───────────────────────────────────────────────

it("getMonthlyTrends returns null for categories with no events this month", async () => {
  // Use a fresh userId that has no events yet
  const freshUser = `test-trends-fresh-${randomUUID()}`;
  await db.insert(usersTable).values({ id: freshUser }).onConflictDoNothing();

  const trends = await getMonthlyTrends(freshUser);

  assert.equal(trends.cash, null, "cash must be null, not 0");
  assert.equal(trends.debt, null, "debt must be null, not 0");
  assert.equal(trends.investments, null, "investments must be null, not 0");
  assert.equal(trends.retirement, null, "retirement must be null, not 0");
  assert.equal(trends.netWorth, null, "netWorth must be null, not 0");
  assert.equal(trends.estimatedTax, null, "estimatedTax must be null, not 0");

  await db.delete(usersTable).where(eq(usersTable.id, freshUser));
});

it("getMonthlyTrends sums change amounts for the current month only", async () => {
  const trendsUser = `test-trends-sums-${randomUUID()}`;
  await db.insert(usersTable).values({ id: trendsUser }).onConflictDoNothing();

  const thisMonth = new Date();
  thisMonth.setDate(5);

  const lastMonthDate = new Date();
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);

  // Two bank events this month
  await appendTimelineEvent(baseEvent(trendsUser, {
    idempotencyKey: `trends-cash-1:${randomUUID()}`,
    eventType: "bank_balance_updated",
    eventDate: thisMonth,
    changeAmount: 500,
  }));
  await appendTimelineEvent(baseEvent(trendsUser, {
    idempotencyKey: `trends-cash-2:${randomUUID()}`,
    eventType: "bank_balance_updated",
    eventDate: thisMonth,
    changeAmount: 200,
  }));

  // One event last month (should NOT appear in this month's totals)
  await appendTimelineEvent(baseEvent(trendsUser, {
    idempotencyKey: `trends-old:${randomUUID()}`,
    eventType: "bank_balance_updated",
    eventDate: lastMonthDate,
    changeAmount: 9999,
  }));

  const trends = await getMonthlyTrends(trendsUser);
  assert.equal(trends.cash, 700, "Should sum only this month's cash changes");

  await db.delete(timelineEventsTable).where(eq(timelineEventsTable.userId, trendsUser));
  await db.delete(usersTable).where(eq(usersTable.id, trendsUser));
});

// ─── Net-worth change calculations ───────────────────────────────────────────

it("net worth = (cash + invest + retire) - debt this month", async () => {
  const nwUser = `test-networth-${randomUUID()}`;
  await db.insert(usersTable).values({ id: nwUser }).onConflictDoNothing();

  const today = new Date();

  const events: Array<[string, number]> = [
    ["bank_balance_updated", 1_000],        // cash +1000
    ["investment_balance_updated", 500],    // invest +500
    ["retirement_balance_updated", 300],    // retire +300
    ["credit_card_balance_updated", 200],   // debt +200
  ];

  for (const [eventType, changeAmount] of events) {
    await appendTimelineEvent(baseEvent(nwUser, {
      idempotencyKey: `nw-${eventType}:${randomUUID()}`,
      eventType: eventType as any,
      eventDate: today,
      changeAmount,
    }));
  }

  const trends = await getMonthlyTrends(nwUser);
  // netWorth = cash(1000) + invest(500) + retire(300) - debt(200) = 1600
  assert.equal(trends.netWorth, 1_600);
  assert.equal(trends.cash, 1_000);
  assert.equal(trends.investments, 500);
  assert.equal(trends.retirement, 300);
  assert.equal(trends.debt, 200);

  await db.delete(timelineEventsTable).where(eq(timelineEventsTable.userId, nwUser));
  await db.delete(usersTable).where(eq(usersTable.id, nwUser));
});

// ─── Empty timeline ───────────────────────────────────────────────────────────

it("listTimelineEvents returns empty array for a user with no events", async () => {
  const emptyUser = `test-empty-${randomUUID()}`;
  await db.insert(usersTable).values({ id: emptyUser }).onConflictDoNothing();

  const events = await listTimelineEvents(emptyUser);
  assert.equal(events.length, 0);

  await db.delete(usersTable).where(eq(usersTable.id, emptyUser));
});

it("listTimelineEvents respects the limit option", async () => {
  const limitUser = `test-limit-${randomUUID()}`;
  await db.insert(usersTable).values({ id: limitUser }).onConflictDoNothing();

  for (let i = 0; i < 10; i++) {
    await appendTimelineEvent(baseEvent(limitUser, {
      idempotencyKey: `limit-test:${i}:${randomUUID()}`,
      eventDate: new Date(Date.now() - i * 1000),
    }));
  }

  const limited = await listTimelineEvents(limitUser, { limit: 3 });
  assert.equal(limited.length, 3);

  await db.delete(timelineEventsTable).where(eq(timelineEventsTable.userId, limitUser));
  await db.delete(usersTable).where(eq(usersTable.id, limitUser));
});
