/**
 * Database operations for subscriptions and usage tracking.
 *
 * Uses pool (pg) directly for raw SQL — consistent with this codebase's pattern.
 *
 * Security: every query filters by userId — never returns another user's data.
 */

import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import {
  resolveEffectivePlan,
  currentPeriodKey,
  type PlanId,
  type SubscriptionState,
} from "./entitlements.js";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubscriptionRow {
  id: string;
  userId: string;
  plan: PlanId;
  status: SubscriptionState;
  provider: string;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  trialEndsAt: Date | null;
  currentPeriodStartsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ─── One-time table creation for idempotency tracking ────────────────────────

let _tablesEnsured = false;

async function ensureStripeEventsTable(): Promise<void> {
  if (_tablesEnsured) return;
  _tablesEnsured = true;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS processed_stripe_events (
        event_id   TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )
    `);
  } catch (err) {
    logger.warn({ err }, "Could not ensure processed_stripe_events table");
  }
}

// ─── Subscription CRUD ────────────────────────────────────────────────────────

export async function getUserSubscription(userId: string): Promise<SubscriptionRow | null> {
  const result = await pool.query<SubscriptionRow>(
    `SELECT id, user_id AS "userId", plan, status, provider,
            provider_customer_id AS "providerCustomerId",
            provider_subscription_id AS "providerSubscriptionId",
            trial_ends_at AS "trialEndsAt",
            current_period_starts_at AS "currentPeriodStartsAt",
            current_period_ends_at AS "currentPeriodEndsAt",
            cancel_at_period_end AS "cancelAtPeriodEnd",
            canceled_at AS "canceledAt",
            metadata, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM subscriptions WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function getUserIdByStripeCustomerId(customerId: string): Promise<string | null> {
  const result = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM subscriptions WHERE provider_customer_id = $1 LIMIT 1`,
    [customerId],
  );
  return result.rows[0]?.user_id ?? null;
}

/** Insert free row on first call; idempotent via ON CONFLICT. */
export async function getOrInitSubscription(userId: string): Promise<SubscriptionRow> {
  await pool.query(
    `INSERT INTO subscriptions (id, user_id, plan, status, provider, metadata)
     VALUES ($1, $2, 'free', 'active', 'manual', '{}')
     ON CONFLICT (user_id) DO NOTHING`,
    [randomUUID(), userId],
  );
  const row = await getUserSubscription(userId);
  if (!row) throw new Error(`Failed to init subscription for userId=${userId}`);
  return row;
}

export interface UpsertSubscriptionFields {
  plan?: PlanId;
  status?: SubscriptionState;
  provider?: string;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  trialEndsAt?: Date | null;
  currentPeriodStartsAt?: Date | null;
  currentPeriodEndsAt?: Date | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export async function upsertSubscription(
  userId: string,
  fields: UpsertSubscriptionFields,
): Promise<void> {
  const {
    plan, status, provider, providerCustomerId, providerSubscriptionId,
    trialEndsAt, currentPeriodStartsAt, currentPeriodEndsAt,
    cancelAtPeriodEnd, canceledAt, metadata,
  } = fields;

  await pool.query(
    `INSERT INTO subscriptions
       (id, user_id, plan, status, provider, provider_customer_id,
        provider_subscription_id, trial_ends_at, current_period_starts_at,
        current_period_ends_at, cancel_at_period_end, canceled_at, metadata)
     VALUES ($1,$2,
       COALESCE($3::subscription_plan,'free'), COALESCE($4::subscription_status,'active'),
       COALESCE($5,'stripe'), $6,$7,$8,$9,$10,
       COALESCE($11,false), $12,
       COALESCE($13::jsonb,'{}'))
     ON CONFLICT (user_id) DO UPDATE SET
       plan                     = COALESCE($3::subscription_plan, subscriptions.plan),
       status                   = COALESCE($4::subscription_status, subscriptions.status),
       provider                 = COALESCE($5, subscriptions.provider),
       provider_customer_id     = COALESCE($6, subscriptions.provider_customer_id),
       provider_subscription_id = COALESCE($7, subscriptions.provider_subscription_id),
       trial_ends_at            = COALESCE($8, subscriptions.trial_ends_at),
       current_period_starts_at = COALESCE($9,  subscriptions.current_period_starts_at),
       current_period_ends_at   = COALESCE($10, subscriptions.current_period_ends_at),
       cancel_at_period_end     = COALESCE($11, subscriptions.cancel_at_period_end),
       canceled_at              = COALESCE($12, subscriptions.canceled_at),
       metadata                 = COALESCE($13::jsonb, subscriptions.metadata),
       updated_at               = NOW()`,
    [
      randomUUID(), userId,
      plan ?? null, status ?? null, provider ?? null,
      providerCustomerId ?? null, providerSubscriptionId ?? null,
      trialEndsAt ?? null, currentPeriodStartsAt ?? null,
      currentPeriodEndsAt ?? null,
      cancelAtPeriodEnd !== undefined ? cancelAtPeriodEnd : null,
      canceledAt ?? null,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
}

// ─── Usage tracking ───────────────────────────────────────────────────────────

export async function getScanUsageForPeriod(
  userId: string,
  periodKey: string,
): Promise<number> {
  const result = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(quantity), 0)::text AS total
     FROM subscription_usage
     WHERE user_id = $1 AND kind = 'document_scan' AND period_key = $2`,
    [userId, periodKey],
  );
  return parseInt(result.rows[0]?.total ?? "0", 10);
}

/** Record one scan. Safe to call multiple times — null idempotency keys do not conflict. */
export async function recordScanUsage(
  userId: string,
  periodKey: string,
  idempotencyKey?: string,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO subscription_usage
         (id, user_id, kind, quantity, period_key, idempotency_key, metadata)
       VALUES ($1,$2,'document_scan',1,$3,$4,'{}')
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [randomUUID(), userId, periodKey, idempotencyKey ?? null],
    );
  } catch (err) {
    logger.warn({ err, userId }, "recordScanUsage failed — non-fatal");
  }
}

// ─── Stripe customer ──────────────────────────────────────────────────────────

export async function getStripeCustomerId(userId: string): Promise<string | null> {
  const sub = await getUserSubscription(userId);
  return sub?.providerCustomerId ?? null;
}

export async function storeStripeCustomerId(userId: string, customerId: string): Promise<void> {
  await upsertSubscription(userId, { providerCustomerId: customerId, provider: "stripe" });
}

// ─── Stripe event idempotency ─────────────────────────────────────────────────

export async function isStripeEventProcessed(eventId: string): Promise<boolean> {
  await ensureStripeEventsTable();
  const result = await pool.query<{ event_id: string }>(
    `SELECT event_id FROM processed_stripe_events WHERE event_id = $1`,
    [eventId],
  );
  return result.rows.length > 0;
}

export async function markStripeEventProcessed(eventId: string): Promise<boolean> {
  await ensureStripeEventsTable();
  const result = await pool.query(
    `INSERT INTO processed_stripe_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [eventId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ─── Resolved plan (used by middleware + routes) ──────────────────────────────

export async function getEffectivePlan(userId: string): Promise<{
  plan: PlanId;
  status: SubscriptionState;
  effectivePlan: PlanId;
  sub: SubscriptionRow;
}> {
  const sub = await getOrInitSubscription(userId);
  const effectivePlan = resolveEffectivePlan({
    plan: sub.plan,
    status: sub.status,
    trialEndsAt: sub.trialEndsAt,
  });
  return { plan: sub.plan, status: sub.status, effectivePlan, sub };
}

export { currentPeriodKey };
