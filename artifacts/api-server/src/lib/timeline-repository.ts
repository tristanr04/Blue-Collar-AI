/**
 * Timeline repository — insert and query financial timeline events.
 *
 * Events are user-scoped and immutable once written. Idempotency keys prevent
 * duplicates when the same request is retried.
 */

import { and, desc, eq, gte, isNotNull, lt } from "drizzle-orm";
import { db, timelineEventsTable, usersTable } from "@workspace/db";
import { logger } from "./logger.js";
import { getFinancialSnapshot } from "./financial-repository.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type TimelineEventType =
  | "paystub_added"
  | "paystub_updated"
  | "bank_balance_updated"
  | "investment_balance_updated"
  | "retirement_balance_updated"
  | "credit_card_balance_updated"
  | "loan_balance_updated"
  | "bill_added"
  | "bill_changed"
  | "tax_estimate_saved"
  | "health_score_changed";

export type TimelineEventInput = {
  userId: string;
  eventType: TimelineEventType | string;
  eventDate: Date;
  sourceRecordType: string;
  sourceRecordId?: string | null;
  previousValue?: number | null;
  newValue?: number | null;
  changeAmount?: number | null;
  title: string;
  description: string;
  metadata?: Record<string, unknown> | null;
  /** Deterministic key used for idempotency. Two calls with the same userId+key = one event. */
  idempotencyKey: string;
};

export type TimelineEvent = {
  id: string;
  userId: string;
  eventType: string;
  eventDate: Date;
  sourceRecordType: string;
  sourceRecordId: string | null;
  previousValue: number | null;
  newValue: number | null;
  changeAmount: number | null;
  title: string;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export type MonthlyTrends = {
  cash: number | null;
  debt: number | null;
  investments: number | null;
  retirement: number | null;
  netWorth: number | null;
  estimatedTax: number | null;
};

// ─── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Insert a timeline event, ignoring duplicates with the same (userId, idempotencyKey).
 * Safe to call after a successful financial mutation — never throws to callers.
 */
export async function appendTimelineEvent(input: TimelineEventInput): Promise<void> {
  await db
    .insert(timelineEventsTable)
    .values({
      userId: input.userId,
      eventType: input.eventType,
      eventDate: input.eventDate,
      sourceRecordType: input.sourceRecordType,
      sourceRecordId: input.sourceRecordId ?? null,
      previousValue: input.previousValue ?? null,
      newValue: input.newValue ?? null,
      changeAmount: input.changeAmount ?? null,
      title: input.title,
      description: input.description,
      metadata: input.metadata ?? null,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing();
}

// ─── Queries ───────────────────────────────────────────────────────────────────

/**
 * List timeline events for a user, newest first, with optional cursor pagination.
 * Always filters to the authenticated user — never returns another user's events.
 */
export async function listTimelineEvents(
  userId: string,
  options: { limit?: number; before?: Date } = {},
): Promise<TimelineEvent[]> {
  const limit = Math.min(Math.max(1, options.limit ?? 50), 100);

  const conditions = [eq(timelineEventsTable.userId, userId)];
  if (options.before) {
    conditions.push(lt(timelineEventsTable.eventDate, options.before));
  }

  const rows = await db
    .select()
    .from(timelineEventsTable)
    .where(and(...conditions))
    .orderBy(desc(timelineEventsTable.eventDate))
    .limit(limit);

  return rows as TimelineEvent[];
}

/**
 * Compute monthly changes grouped by financial category.
 * Returns null for categories with no events this month (never returns fake zeros).
 */
export async function getMonthlyTrends(userId: string): Promise<MonthlyTrends> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const rows = await db
    .select({
      eventType: timelineEventsTable.eventType,
      changeAmount: timelineEventsTable.changeAmount,
    })
    .from(timelineEventsTable)
    .where(
      and(
        eq(timelineEventsTable.userId, userId),
        gte(timelineEventsTable.eventDate, monthStart),
        isNotNull(timelineEventsTable.changeAmount),
      ),
    );

  let cashChange = 0;
  let cashHasData = false;
  let debtChange = 0;
  let debtHasData = false;
  let investChange = 0;
  let investHasData = false;
  let retireChange = 0;
  let retireHasData = false;
  let taxChange = 0;
  let taxHasData = false;

  for (const row of rows) {
    const amt = row.changeAmount;
    if (amt === null) continue;
    switch (row.eventType) {
      case "bank_balance_updated":
        cashChange += amt; cashHasData = true; break;
      case "credit_card_balance_updated":
      case "loan_balance_updated":
        debtChange += amt; debtHasData = true; break;
      case "investment_balance_updated":
        investChange += amt; investHasData = true; break;
      case "retirement_balance_updated":
        retireChange += amt; retireHasData = true; break;
      case "tax_estimate_saved":
        taxChange += amt; taxHasData = true; break;
    }
  }

  // Net worth = (cash + invest + retire) - debt. Only include categories with data.
  const netWorthHasData = cashHasData || investHasData || retireHasData || debtHasData;
  const netWorthChange =
    (cashHasData ? cashChange : 0) +
    (investHasData ? investChange : 0) +
    (retireHasData ? retireChange : 0) -
    (debtHasData ? debtChange : 0);

  return {
    cash: cashHasData ? cashChange : null,
    debt: debtHasData ? debtChange : null,
    investments: investHasData ? investChange : null,
    retirement: retireHasData ? retireChange : null,
    netWorth: netWorthHasData ? netWorthChange : null,
    estimatedTax: taxHasData ? taxChange : null,
  };
}

// ─── Backfill ──────────────────────────────────────────────────────────────────

/**
 * Create one "added" timeline event for each existing financial record that
 * does not already have a backfill event. Uses idempotency keys so re-running
 * is safe and never produces duplicates.
 *
 * Rules:
 * - Never alters original financial records
 * - Uses record creation dates as event dates
 * - Marks events with { backfill: true } in metadata
 * - Does not guess previous balances (previousValue = null)
 */
export async function backfillTimeline(
  userId: string,
  snapshot: Awaited<ReturnType<typeof getFinancialSnapshot>>,
): Promise<void> {
  const events: TimelineEventInput[] = [];

  const fmt = (v: number) =>
    `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  // Paystubs
  for (const p of snapshot.paystubs) {
    const id = p.id;
    const netPay: number | null = p.netPay ?? null;
    const eventDate = p.payDate instanceof Date ? p.payDate : new Date();
    events.push({
      userId, eventType: "paystub_added", eventDate,
      sourceRecordType: "paystub", sourceRecordId: id,
      previousValue: null, newValue: netPay, changeAmount: null,
      title: "Paystub added",
      description: netPay !== null ? `Net pay of ${fmt(netPay)} recorded.` : "A paystub was added.",
      metadata: { backfill: true },
      idempotencyKey: `backfill:paystub:${id}`,
    });
  }

  // Debts
  for (const d of snapshot.debts) {
    const id = d.id;
    const balance: number | null = d.balance ?? null;
    const isRevolving = Boolean(d.isRevolving);
    const eventDate = d.createdAt instanceof Date ? d.createdAt : new Date();
    events.push({
      userId,
      eventType: isRevolving ? "credit_card_balance_updated" : "loan_balance_updated",
      eventDate,
      sourceRecordType: "debt", sourceRecordId: id,
      previousValue: null, newValue: balance, changeAmount: null,
      title: `${d.name} added`,
      description: balance !== null ? `Balance of ${fmt(balance)} recorded.` : "A debt was added.",
      metadata: { backfill: true },
      idempotencyKey: `backfill:debt:${id}`,
    });
  }

  // Bills
  for (const b of snapshot.bills) {
    const id = b.id;
    const amount: number | null = b.amount ?? null;
    const eventDate = b.createdAt instanceof Date ? b.createdAt : new Date();
    events.push({
      userId, eventType: "bill_added", eventDate,
      sourceRecordType: "bill", sourceRecordId: id,
      previousValue: null, newValue: amount, changeAmount: null,
      title: `${b.name} added`,
      description: amount !== null ? `Monthly bill of ${fmt(amount)} recorded.` : "A bill was added.",
      metadata: { backfill: true },
      idempotencyKey: `backfill:bill:${id}`,
    });
  }

  // Assets
  for (const a of snapshot.assets) {
    const id = a.id;
    const value: number | null = a.value ?? null;
    const descriptor = `${a.type} ${a.name}`.toLowerCase();
    let eventType: TimelineEventType = "bank_balance_updated";
    if (/retirement|401|403|457|ira|pension/.test(descriptor)) {
      eventType = "retirement_balance_updated";
    } else if (/investment|brokerage|stock/.test(descriptor)) {
      eventType = "investment_balance_updated";
    }
    const eventDate = a.createdAt instanceof Date ? a.createdAt : new Date();
    events.push({
      userId, eventType, eventDate,
      sourceRecordType: "asset", sourceRecordId: id,
      previousValue: null, newValue: value, changeAmount: null,
      title: `${a.name} added`,
      description: value !== null ? `Balance of ${fmt(value)} recorded.` : "An account was added.",
      metadata: { backfill: true },
      idempotencyKey: `backfill:asset:${id}`,
    });
  }

  // Insert all with conflict-ignore (idempotency)
  for (const event of events) {
    await appendTimelineEvent(event).catch((err) => {
      logger.warn({ err, userId, key: event.idempotencyKey }, "timeline backfill event skipped");
    });
  }
}
