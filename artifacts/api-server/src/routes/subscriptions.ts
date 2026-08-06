/**
 * Subscription API routes.
 *
 * GET  /subscriptions/plans    — public, all plan definitions
 * GET  /subscriptions/me       — authenticated, user's current subscription
 * POST /subscriptions/checkout — create Stripe Checkout session (rate-limited)
 * POST /subscriptions/portal   — create Stripe Customer Portal session (rate-limited)
 * POST /subscriptions/check    — entitlement check for a feature + usage count
 */

import { Router, type IRouter } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "../middlewares/auth.js";
import { checkoutLimiter, portalLimiter } from "../middlewares/rate-limit.js";
import { ensureUser } from "../lib/financial-repository.js";
import {
  getOrInitSubscription,
  getEffectivePlan,
  getScanUsageForPeriod,
  storeStripeCustomerId,
  getStripeCustomerId,
  currentPeriodKey,
} from "../lib/subscription-repository.js";
import {
  PLAN_DEFINITIONS,
  PLAN_MARKETING,
  getStripePriceId,
  stripeIsConfigured,
} from "../lib/subscription-plans.js";
import { checkEntitlement, type MeteredFeature } from "../lib/entitlements.js";
import { getStripe } from "../lib/stripe.js";
import { healthScoreCache, commandCenterCache } from "../lib/route-cache.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ─── Plans (public) ────────────────────────────────────────────────────────────

router.get("/subscriptions/plans", (_req, res) => {
  const plans = Object.values(PLAN_DEFINITIONS).map((def) => ({
    ...def,
    marketing: PLAN_MARKETING[def.id],
    stripeAvailable: stripeIsConfigured(),
  }));
  res.json({ plans });
});

// ─── Current subscription ──────────────────────────────────────────────────────

router.get("/subscriptions/me", requireAuthenticatedUser, async (req: AuthenticatedRequest, res) => {
  const userId = req.authenticatedUserId!;
  try {
    await ensureUser({ userId });
    const { effectivePlan, status, sub } = await getEffectivePlan(userId);
    const periodKey = currentPeriodKey();
    const scansUsed = await getScanUsageForPeriod(userId, periodKey);
    const limits = PLAN_DEFINITIONS[effectivePlan].limits;

    const billingWarning =
      status === "past_due" ? "Your payment is past due. Please update your payment method." :
      status === "unpaid"   ? "Your subscription is unpaid. Access is restricted." :
      null;

    res.json({
      plan: sub.plan,
      status,
      effectivePlan,
      billingWarning,
      periodKey,
      currentPeriodEndsAt: sub.currentPeriodEndsAt,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      canceledAt: sub.canceledAt,
      usage: {
        document_scan: { used: scansUsed, limit: limits.document_scan },
        ai_question:   { used: 0, limit: limits.ai_question },      // tracked in future
        tax_scenario:  { used: 0, limit: limits.tax_scenario },
        cloud_document: { used: 0, limit: limits.cloud_document },
      },
      definition: PLAN_DEFINITIONS[effectivePlan],
      marketing: PLAN_MARKETING[effectivePlan],
      stripeAvailable: stripeIsConfigured(),
      hasStripeSubscription: !!sub.providerSubscriptionId,
    });
  } catch (err) {
    logger.error({ err, userId }, "subscriptions/me failed");
    res.status(500).json({ error: "Unable to load your subscription." });
  }
});

// ─── Entitlement check ─────────────────────────────────────────────────────────

const VALID_FEATURES: MeteredFeature[] = [
  "document_scan", "ai_question", "tax_scenario", "cloud_document",
];

router.post("/subscriptions/check", requireAuthenticatedUser, async (req: AuthenticatedRequest, res) => {
  const userId = req.authenticatedUserId!;
  const feature = req.body?.feature as MeteredFeature | undefined;
  if (!feature || !VALID_FEATURES.includes(feature)) {
    res.status(400).json({ error: "A valid metered feature is required." });
    return;
  }
  try {
    const { effectivePlan } = await getEffectivePlan(userId);
    const periodKey = currentPeriodKey();
    const used = feature === "document_scan"
      ? await getScanUsageForPeriod(userId, periodKey)
      : Math.max(0, Number(req.body?.used ?? 0));
    const requested = Math.max(1, Number(req.body?.requested ?? 1));
    res.json(checkEntitlement({ plan: effectivePlan, feature, used, requested }));
  } catch (err) {
    logger.error({ err, userId }, "subscriptions/check failed");
    res.status(500).json({ error: "Unable to check entitlement." });
  }
});

// ─── Stripe Checkout session ───────────────────────────────────────────────────

router.post(
  "/subscriptions/checkout",
  requireAuthenticatedUser,
  checkoutLimiter,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.authenticatedUserId!;

    if (!stripeIsConfigured()) {
      res.status(503).json({
        stage: "stripe_unavailable",
        error: "Checkout is temporarily unavailable. Please try again later.",
        stripeAvailable: false,
      });
      return;
    }

    const plan = req.body?.plan;
    if (plan !== "pro" && plan !== "business") {
      res.status(400).json({ error: "Plan must be 'pro' or 'business'." });
      return;
    }

    const priceId = getStripePriceId(plan);
    if (!priceId) {
      res.status(503).json({
        stage: "stripe_price_missing",
        error: `No Stripe price configured for the ${plan} plan.`,
      });
      return;
    }

    try {
      await ensureUser({ userId });
      const stripe = await getStripe();
      if (!stripe) throw new Error("Stripe unavailable");

      // Get or create Stripe customer
      let customerId = await getStripeCustomerId(userId);
      if (!customerId) {
        const customer = await stripe.customers.create({
          metadata: { userId },
        });
        customerId = customer.id;
        await storeStripeCustomerId(userId, customerId);
      }

      const origin = req.headers.origin ?? "https://localhost";
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        client_reference_id: userId,
        metadata: { userId },
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/settings?billing=success`,
        cancel_url:  `${origin}/pricing?billing=canceled`,
        allow_promotion_codes: true,
        subscription_data: {
          metadata: { userId },
        },
      });

      // Invalidate cached data so the next request fetches fresh plan state
      commandCenterCache.invalidate(userId);
      healthScoreCache.invalidate(userId);

      logger.info({ event: "checkout_session_created", userId, plan }, "Checkout session created");
      res.json({ url: session.url });
    } catch (err) {
      logger.error({ err, userId, plan }, "Checkout session creation failed");
      res.status(500).json({ error: "Unable to start checkout. Please try again." });
    }
  },
);

// ─── Stripe Customer Portal ────────────────────────────────────────────────────

router.post(
  "/subscriptions/portal",
  requireAuthenticatedUser,
  portalLimiter,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.authenticatedUserId!;

    if (!stripeIsConfigured()) {
      res.status(503).json({
        stage: "stripe_unavailable",
        error: "Billing management is temporarily unavailable.",
        stripeAvailable: false,
      });
      return;
    }

    try {
      const customerId = await getStripeCustomerId(userId);
      if (!customerId) {
        res.status(404).json({
          error: "No billing account found. Please subscribe first.",
        });
        return;
      }

      const stripe = await getStripe();
      if (!stripe) throw new Error("Stripe unavailable");

      const origin = req.headers.origin ?? "https://localhost";
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/settings`,
      });

      logger.info({ event: "portal_session_created", userId }, "Billing portal session created");
      res.json({ url: session.url });
    } catch (err) {
      logger.error({ err, userId }, "Billing portal session failed");
      res.status(500).json({ error: "Unable to open billing portal. Please try again." });
    }
  },
);

export default router;
