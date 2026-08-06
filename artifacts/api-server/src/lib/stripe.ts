/**
 * Stripe SDK singleton.
 *
 * Returns null when STRIPE_SECRET_KEY is not set — the app runs
 * gracefully without credentials. Never log or expose the secret key.
 */

import type Stripe from "stripe";

let _stripe: Stripe | null = null;
let _initDone = false;

export async function getStripe(): Promise<Stripe | null> {
  if (_initDone) return _stripe;
  _initDone = true;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;

  const { default: StripeClass } = await import("stripe");
  _stripe = new StripeClass(key, {
    apiVersion: "2026-07-29.dahlia",
    telemetry: false,
  });
  return _stripe;
}

export function stripeIsAvailable(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * Verify a Stripe webhook signature.
 * rawBody must be the unmodified Buffer from express.raw().
 * Throws on invalid signature or missing config.
 */
export async function constructStripeEvent(
  rawBody: Buffer,
  signature: string,
): Promise<Stripe.Event> {
  const stripe = await getStripe();
  if (!stripe) throw new Error("Stripe is not configured.");

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set.");

  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}
