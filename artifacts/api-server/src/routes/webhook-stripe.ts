/**
 * Stripe webhook handler.
 *
 * Security:
 *  - Route is mounted BEFORE express.json() so it receives the raw body.
 *  - Signature is verified via stripe.webhooks.constructEvent().
 *  - Every event is processed idempotently: duplicate events are silently ignored.
 *  - Webhook is the source of truth — access is never granted based on
 *    frontend redirects alone.
 *  - No payment amounts, card details, or PII are logged.
 *
 * Handled events:
 *  - checkout.session.completed
 *  - customer.subscription.created
 *  - customer.subscription.updated
 *  - customer.subscription.deleted
 *  - invoice.paid
 *  - invoice.payment_failed
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { constructStripeEvent as _constructStripeEvent } from "../lib/stripe.js";
import {
  isStripeEventProcessed as _isProcessed,
  markStripeEventProcessed as _markProcessed,
  upsertSubscription as _upsert,
  storeStripeCustomerId as _store,
  getUserIdByStripeCustomerId as _getUserId,
} from "../lib/subscription-repository.js";
import { logger } from "../lib/logger.js";
import type { PlanId, SubscriptionState } from "../lib/entitlements.js";
import type Stripe from "stripe";

// ─── Dependency types (for injection in tests) ────────────────────────────────

export interface WebhookDeps {
  constructStripeEvent: (rawBody: Buffer, sig: string) => Promise<Stripe.Event>;
  isStripeEventProcessed: (id: string) => Promise<boolean>; // boolean, not void
  markStripeEventProcessed: (id: string) => Promise<boolean | void>;
  upsertSubscription: (userId: string, data: unknown) => Promise<void>;
  storeStripeCustomerId: (userId: string, customerId: string) => Promise<void>;
  getUserIdByStripeCustomerId: (customerId: string) => Promise<string | null>;
}

const realDeps: WebhookDeps = {
  constructStripeEvent: _constructStripeEvent,
  isStripeEventProcessed: async (id) => _isProcessed(id),
  markStripeEventProcessed: async (id) => { await _markProcessed(id); },
  upsertSubscription: _upsert as WebhookDeps["upsertSubscription"],
  storeStripeCustomerId: _store,
  getUserIdByStripeCustomerId: _getUserId,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

class WebhookRetryableError extends Error {}

function stripeStatusToOurs(status: Stripe.Subscription.Status): SubscriptionState {
  switch (status) {
    case "active":      return "active";
    case "trialing":    return "trialing";
    case "past_due":    return "past_due";
    case "canceled":    return "canceled";
    case "incomplete":  return "incomplete";
    case "unpaid":      return "unpaid";
    default:            return "incomplete";
  }
}

function getPlanForPriceId(priceId: string): PlanId | null {
  if (priceId && priceId === process.env.STRIPE_PRO_PRICE_ID)      return "pro";
  if (priceId && priceId === process.env.STRIPE_BUSINESS_PRICE_ID) return "business";
  return null;
}

function getPlanFromSubscription(sub: Stripe.Subscription): PlanId | null {
  const priceId = sub.items.data[0]?.price?.id;
  return priceId ? getPlanForPriceId(priceId) : null;
}

function tsToDate(ts: number | null | undefined): Date | null {
  return ts ? new Date(ts * 1000) : null;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates the webhook Express router with injectable dependencies.
 * Production code calls this with the default real dependencies.
 * Tests inject stubs to avoid module mocking.
 */
export function createWebhookRouter(deps: WebhookDeps = realDeps): IRouter {
  const router: IRouter = Router();

  async function handleSubscriptionEvent(
    stripeSub: Stripe.Subscription,
    userId: string,
  ): Promise<void> {
    const plan   = getPlanFromSubscription(stripeSub) ?? "free";
    const status = stripeStatusToOurs(stripeSub.status);

    await deps.upsertSubscription(userId, {
      plan,
      status,
      provider: "stripe",
      providerCustomerId: String(stripeSub.customer),
      providerSubscriptionId: stripeSub.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      currentPeriodStartsAt: tsToDate((stripeSub as any).current_period_start),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      currentPeriodEndsAt: tsToDate((stripeSub as any).current_period_end),
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      canceledAt: tsToDate(stripeSub.canceled_at ?? null),
    });

    logger.info(
      { event: "subscription_upserted", userId, plan, status },
      "Stripe subscription synced",
    );
  }

  async function processEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId =
          session.client_reference_id ??
          (session.metadata?.userId as string | undefined);

        if (!userId) {
          logger.warn(
            { sessionId: session.id, event: "webhook_missing_user" },
            "checkout.session.completed: no userId found",
          );
          break;
        }

        const customerId = String(session.customer ?? "");
        if (customerId) await deps.storeStripeCustomerId(userId, customerId);

        logger.info({ event: "checkout_completed", userId }, "Checkout session completed");
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const stripeSub   = event.data.object as Stripe.Subscription;
        const customerId  = String(stripeSub.customer);
        const userId      = await deps.getUserIdByStripeCustomerId(customerId);
        if (!userId) {
          logger.warn({ customerId, event: "webhook_no_user_for_customer" }, "No user for Stripe customer");
          break;
        }
        await handleSubscriptionEvent(stripeSub, userId);
        break;
      }

      case "customer.subscription.deleted": {
        const stripeSub  = event.data.object as Stripe.Subscription;
        const customerId = String(stripeSub.customer);
        const userId     = await deps.getUserIdByStripeCustomerId(customerId);
        if (!userId) break;

        await deps.upsertSubscription(userId, {
          plan: "free",
          status: "canceled",
          providerSubscriptionId: stripeSub.id,
          canceledAt: tsToDate(stripeSub.canceled_at ?? null) ?? new Date(),
          cancelAtPeriodEnd: false,
        });
        logger.info({ event: "subscription_canceled", userId }, "Subscription deleted");
        break;
      }

      case "invoice.paid": {
        const invoice    = event.data.object as Stripe.Invoice;
        const customerId = String(invoice.customer ?? "");
        if (!customerId) break;
        const userId = await deps.getUserIdByStripeCustomerId(customerId);
        if (!userId) break;
        await deps.upsertSubscription(userId, { status: "active" });
        logger.info({ event: "invoice_paid", userId }, "Invoice paid — subscription active");
        break;
      }

      case "invoice.payment_failed": {
        const invoice    = event.data.object as Stripe.Invoice;
        const customerId = String(invoice.customer ?? "");
        if (!customerId) break;
        const userId = await deps.getUserIdByStripeCustomerId(customerId);
        if (!userId) break;
        await deps.upsertSubscription(userId, { status: "past_due" });
        logger.warn({ event: "invoice_payment_failed", userId }, "Invoice payment failed");
        break;
      }

      default:
        logger.debug({ eventType: event.type }, "Unhandled Stripe event type");
    }
  }

  // Router is mounted at the full webhook URL (/api/webhooks/stripe) in app.ts,
  // so this handler lives at the root of that router.
  router.post("/", async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"];
    if (!signature || typeof signature !== "string") {
      res.status(400).json({ error: "Missing stripe-signature header." });
      return;
    }

    // req.body is a raw Buffer — express.raw() must be mounted for this path.
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Empty or non-raw body." });
      return;
    }

    let event: Stripe.Event;
    try {
      event = await deps.constructStripeEvent(req.body, signature);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Signature verification failed";
      logger.warn({ event: "webhook_signature_failed" }, msg);
      res.status(400).json({ error: msg });
      return;
    }

    if (await deps.isStripeEventProcessed(event.id)) {
      res.json({ received: true, skipped: "already_processed" });
      return;
    }

    try {
      await processEvent(event);
      await deps.markStripeEventProcessed(event.id);
      res.json({ received: true });
    } catch (err) {
      logger.error(
        { err, eventType: event.type, event: "webhook_processing_error" },
        "Stripe webhook processing failed",
      );
      if (err instanceof WebhookRetryableError) {
        res.status(500).json({ error: "Temporary error — retry." });
      } else {
        res.json({ received: true, processingError: "non_retryable" });
      }
    }
  });

  return router;
}

export default createWebhookRouter();
