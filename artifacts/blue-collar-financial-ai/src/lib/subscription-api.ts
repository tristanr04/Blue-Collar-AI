/**
 * Subscription API client — types and fetch helpers.
 * All calls go to /api/subscriptions/* on the API server.
 */

const API_BASE = "/api";

// ─── Shared fetch helper ──────────────────────────────────────────────────────

async function subFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlanId = "free" | "pro" | "business";
export type SubscriptionStatus =
  | "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "unpaid";

export interface UsageStat {
  used: number;
  limit: number | null;
}

export interface SubscriptionResponse {
  plan: PlanId;
  status: SubscriptionStatus;
  effectivePlan: PlanId;
  billingWarning: string | null;
  periodKey: string;
  currentPeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  usage: {
    document_scan: UsageStat;
    ai_question: UsageStat;
    tax_scenario: UsageStat;
    cloud_document: UsageStat;
  };
  definition: {
    id: PlanId;
    name: string;
    monthlyPriceCents: number;
    limits: Record<string, number | null>;
    features: string[];
  };
  marketing: {
    tagline: string;
    cta: string;
    features: string[];
    notIncluded?: string[];
  };
  stripeAvailable: boolean;
  hasStripeSubscription: boolean;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  monthlyPriceCents: number;
  limits: Record<string, number | null>;
  features: string[];
  marketing: {
    tagline: string;
    cta: string;
    features: string[];
    notIncluded?: string[];
  };
  stripeAvailable: boolean;
}

export interface PlansResponse {
  plans: PlanDefinition[];
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function getMySubscription(token: string): Promise<SubscriptionResponse> {
  const res = await subFetch("/subscriptions/me", token);
  return res.json() as Promise<SubscriptionResponse>;
}

export async function getPlans(token: string): Promise<PlansResponse> {
  // Plans endpoint is public but we pass token for consistency
  const res = await fetch(`${API_BASE}/subscriptions/plans`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load plans");
  return res.json() as Promise<PlansResponse>;
}

export async function createCheckoutSession(
  token: string,
  plan: "pro" | "business",
): Promise<{ url: string | null }> {
  const res = await subFetch("/subscriptions/checkout", token, {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
  return res.json() as Promise<{ url: string | null }>;
}

export async function createBillingPortalSession(
  token: string,
): Promise<{ url: string | null }> {
  const res = await subFetch("/subscriptions/portal", token, { method: "POST" });
  return res.json() as Promise<{ url: string | null }>;
}

export async function checkEntitlement(
  token: string,
  feature: string,
  used?: number,
): Promise<{ allowed: boolean; limit: number | null; used: number; remaining: number | null }> {
  const res = await subFetch("/subscriptions/check", token, {
    method: "POST",
    body: JSON.stringify({ feature, used: used ?? 0 }),
  });
  return res.json();
}
