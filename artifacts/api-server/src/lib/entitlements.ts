export type PlanId = "free" | "pro" | "business";
export type SubscriptionState = "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "unpaid";
export type MeteredFeature = "document_scan" | "ai_question" | "tax_scenario" | "cloud_document";

export type PlanDefinition = {
  id: PlanId;
  name: string;
  monthlyPriceCents: number;
  limits: Record<MeteredFeature, number | null>;
  features: string[];
};

export const PLAN_DEFINITIONS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    monthlyPriceCents: 0,
    limits: { document_scan: 10, ai_question: 20, tax_scenario: 3, cloud_document: 10 },
    features: ["Core dashboard", "Manual financial tracking", "Basic document scanning"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyPriceCents: 1499,
    limits: { document_scan: 150, ai_question: 300, tax_scenario: 50, cloud_document: 500 },
    features: ["Advanced scanner recovery", "Tax estimator", "Age progress", "Saved scenarios", "Priority processing"],
  },
  business: {
    id: "business",
    name: "Business",
    monthlyPriceCents: 4999,
    limits: { document_scan: null, ai_question: null, tax_scenario: null, cloud_document: 5000 },
    features: ["Unlimited scanning and AI", "Crew referrals", "Admin analytics", "Company benchmarking"],
  },
};

export function isAccessActive(status: SubscriptionState, trialEndsAt?: Date | null): boolean {
  if (status === "active") return true;
  if (status === "trialing") return !trialEndsAt || trialEndsAt.getTime() > Date.now();
  return false;
}

export function resolveEffectivePlan(input: {
  plan?: PlanId | null;
  status?: SubscriptionState | null;
  trialEndsAt?: Date | null;
}): PlanId {
  const plan = input.plan ?? "free";
  if (plan === "free") return "free";
  return isAccessActive(input.status ?? "active", input.trialEndsAt) ? plan : "free";
}

export function checkEntitlement(input: {
  plan: PlanId;
  feature: MeteredFeature;
  used: number;
  requested?: number;
}) {
  const requested = Math.max(1, input.requested ?? 1);
  const limit = PLAN_DEFINITIONS[input.plan].limits[input.feature];
  const allowed = limit === null || input.used + requested <= limit;
  return {
    allowed,
    plan: input.plan,
    feature: input.feature,
    used: input.used,
    requested,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - input.used),
    upgradeRequired: !allowed && input.plan === "free",
  };
}

export function currentPeriodKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
