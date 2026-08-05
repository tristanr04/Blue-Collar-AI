import { Router, type IRouter } from "express";
import { PLAN_DEFINITIONS, checkEntitlement, currentPeriodKey, resolveEffectivePlan, type MeteredFeature, type PlanId, type SubscriptionState } from "../lib/entitlements.js";

const router: IRouter = Router();

function readPlanHeader(value: string | undefined): PlanId {
  return value === "pro" || value === "business" ? value : "free";
}

function readStatusHeader(value: string | undefined): SubscriptionState {
  const allowed: SubscriptionState[] = ["trialing", "active", "past_due", "canceled", "incomplete", "unpaid"];
  return allowed.includes(value as SubscriptionState) ? value as SubscriptionState : "active";
}

router.get("/subscriptions/plans", (_req, res) => {
  res.json({ plans: Object.values(PLAN_DEFINITIONS) });
});

router.get("/subscriptions/me", (req, res) => {
  const plan = readPlanHeader(req.header("x-subscription-plan") ?? undefined);
  const status = readStatusHeader(req.header("x-subscription-status") ?? undefined);
  const effectivePlan = resolveEffectivePlan({ plan, status });
  res.json({
    plan,
    status,
    effectivePlan,
    periodKey: currentPeriodKey(),
    definition: PLAN_DEFINITIONS[effectivePlan],
    source: "header-fallback",
    warning: "Replace header fallback with authenticated database lookup before production.",
  });
});

router.post("/subscriptions/check", (req, res) => {
  const feature = req.body?.feature as MeteredFeature | undefined;
  const validFeatures: MeteredFeature[] = ["document_scan", "ai_question", "tax_scenario", "cloud_document"];
  if (!feature || !validFeatures.includes(feature)) {
    res.status(400).json({ error: "A valid metered feature is required." });
    return;
  }

  const plan = resolveEffectivePlan({
    plan: readPlanHeader(req.header("x-subscription-plan") ?? undefined),
    status: readStatusHeader(req.header("x-subscription-status") ?? undefined),
  });
  const used = Number.isFinite(Number(req.body?.used)) ? Math.max(0, Number(req.body.used)) : 0;
  const requested = Number.isFinite(Number(req.body?.requested)) ? Math.max(1, Number(req.body.requested)) : 1;
  res.json(checkEntitlement({ plan, feature, used, requested }));
});

export default router;
