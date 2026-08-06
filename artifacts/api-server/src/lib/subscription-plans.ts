/**
 * Centralized subscription plan configuration.
 *
 * SINGLE SOURCE OF TRUTH for:
 *  - Plan limits (scans, AI, tax scenarios, cloud docs)
 *  - Monthly prices (cents)
 *  - Stripe price IDs (env vars)
 *  - Pricing-page marketing copy
 *
 * Import from here — never hard-code limits or prices elsewhere.
 */

import { PLAN_DEFINITIONS, type PlanId } from "./entitlements.js";
export { PLAN_DEFINITIONS, type PlanId };

// ─── Stripe price IDs ─────────────────────────────────────────────────────────
// After creating recurring monthly prices in the Stripe dashboard (test mode),
// set STRIPE_PRO_PRICE_ID and STRIPE_BUSINESS_PRICE_ID in your environment.
export function getStripePriceId(plan: "pro" | "business"): string | null {
  if (plan === "pro")      return process.env.STRIPE_PRO_PRICE_ID ?? null;
  if (plan === "business") return process.env.STRIPE_BUSINESS_PRICE_ID ?? null;
  return null;
}

// ─── Pricing-page display ─────────────────────────────────────────────────────
export const PLAN_MARKETING: Record<PlanId, {
  tagline: string;
  cta: string;
  features: string[];
  notIncluded?: string[];
}> = {
  free: {
    tagline: "Get started at no cost",
    cta: "Get started free",
    features: [
      "10 document scans per month",
      "20 AI questions per month",
      "Core financial dashboard",
      "Manual income & expense tracking",
      "Basic debt tracking",
      "Up to 3 tax scenarios",
    ],
    notIncluded: [
      "Full AI financial analysis",
      "Weekly financial snapshots",
      "Financial health score",
      "Priority processing",
    ],
  },
  pro: {
    tagline: "Everything you need to get ahead",
    cta: "Start Pro",
    features: [
      "150 document scans per month",
      "300 AI questions per month",
      "Full AI financial analysis",
      "Financial health score",
      "Weekly financial snapshots",
      "50 tax scenarios",
      "Up to 500 cloud documents",
      "Financial timeline & history",
      "Export & reporting features",
      "Priority processing",
    ],
  },
  business: {
    tagline: "For teams and contractors",
    cta: "Start Business",
    features: [
      "Unlimited document scans",
      "Unlimited AI analysis",
      "Everything in Pro",
      "Multiple users / team seats",
      "Shared client workspace",
      "5,000 cloud documents",
      "Business reporting",
      "Admin analytics & controls",
      "Crew referral program",
    ],
  },
};

/** True only when all Stripe env vars are present. */
export function stripeIsConfigured(): boolean {
  return !!(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_PRO_PRICE_ID &&
    process.env.STRIPE_BUSINESS_PRICE_ID
  );
}
