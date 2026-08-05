import type { NotificationCandidate } from "./retention-notifications.js";

type SpendingInput = {
  monthlyTakeHome?: number;
  currentFlexibleSpending?: number;
  previousFlexibleSpending?: number;
  topCategory?: string;
  topCategoryAmount?: number;
  subscriptionsMonthly?: number;
  possibleSubscriptionSavings?: number;
};

type TaxInput = {
  projectedOwed?: number;
  refundChange?: number;
  missingDocuments?: string[];
  withholdingConfidence?: "low" | "medium" | "high";
};

type InsuranceInput = {
  policyType?: string;
  renewalDate?: string;
  premiumIncrease?: number;
  missingCoverageFields?: string[];
};

type CreditInput = {
  utilization?: number;
  previousUtilization?: number;
  paymentDueDate?: string;
  minimumPayment?: number;
};

type GoalInput = {
  id: string;
  name: string;
  current: number;
  target: number;
  targetDate?: string;
  previousCurrent?: number;
};

type ExpiringDocument = {
  id: string;
  type: string;
  expiresAt: string;
};

export type CandidateGenerationInput = {
  spending?: SpendingInput;
  tax?: TaxInput;
  insurance?: InsuranceInput[];
  credit?: CreditInput;
  goals?: GoalInput[];
  expiringDocuments?: ExpiringDocument[];
};

function n(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function daysUntil(date: string): number | null {
  const time = new Date(date).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.ceil((time - Date.now()) / 86_400_000);
}

export function generateNotificationCandidates(input: CandidateGenerationInput): NotificationCandidate[] {
  const candidates: NotificationCandidate[] = [];
  const spending = input.spending;

  if (spending) {
    const income = n(spending.monthlyTakeHome);
    const flexible = n(spending.currentFlexibleSpending);
    const previous = n(spending.previousFlexibleSpending);
    const share = income > 0 ? flexible / income : 0;
    const increase = previous > 0 ? (flexible - previous) / previous : 0;

    if (share >= 0.35 || increase >= 0.2) {
      const monthlyRedirect = Math.max(25, Math.round(Math.min(flexible * 0.15, income * 0.08)));
      candidates.push({
        id: "spending-flexible-pattern",
        dedupeKey: `spending:flexible:${Math.round(share * 10)}`,
        category: "spending",
        urgency: share >= 0.5 ? "high" : "medium",
        title: "Your flexible spending has room to work harder",
        body: `${spending.topCategory || "Flexible spending"} was the largest area this month. Redirecting about $${monthlyRedirect} could create roughly $${monthlyRedirect * 12} per year for your goals.`,
        actionLabel: "Review spending",
        actionPath: "/spending",
        estimatedDollarImpact: monthlyRedirect * 12,
      });
    }

    if (n(spending.possibleSubscriptionSavings) >= 10) {
      const savings = n(spending.possibleSubscriptionSavings);
      candidates.push({
        id: "spending-subscription-savings",
        dedupeKey: `spending:subscriptions:${Math.round(savings)}`,
        category: "spending",
        urgency: savings >= 50 ? "high" : "medium",
        title: "Possible recurring-charge savings found",
        body: `Reviewing recurring charges may free about $${Math.round(savings)} per month.`,
        actionLabel: "Review subscriptions",
        actionPath: "/spending/subscriptions",
        estimatedDollarImpact: savings * 12,
      });
    }
  }

  const tax = input.tax;
  if (tax) {
    if (n(tax.projectedOwed) >= 100) {
      const owed = n(tax.projectedOwed);
      candidates.push({
        id: "tax-projected-balance",
        dedupeKey: `tax:owed:${Math.round(owed / 100) * 100}`,
        category: "tax",
        urgency: owed >= 2000 ? "critical" : owed >= 500 ? "high" : "medium",
        title: "Your projected tax balance needs a review",
        body: `The current estimate shows about $${Math.round(owed)} potentially owed. Review withholding and projected overtime before the gap grows.`,
        actionLabel: "Open tax estimator",
        actionPath: "/tax-estimator",
        estimatedDollarImpact: owed,
      });
    }

    if ((tax.missingDocuments ?? []).length) {
      candidates.push({
        id: "tax-missing-documents",
        dedupeKey: `tax:missing:${[...(tax.missingDocuments ?? [])].sort().join("|")}`,
        category: "tax",
        urgency: "medium",
        title: "Your tax estimate is missing information",
        body: `Upload or confirm: ${(tax.missingDocuments ?? []).slice(0, 3).join(", ")}.`,
        actionLabel: "Complete estimate",
        actionPath: "/tax-estimator",
      });
    }
  }

  for (const policy of input.insurance ?? []) {
    const days = policy.renewalDate ? daysUntil(policy.renewalDate) : null;
    if (days !== null && days <= 30) {
      candidates.push({
        id: `insurance-renewal-${policy.policyType || "policy"}`,
        dedupeKey: `insurance:renewal:${policy.policyType}:${policy.renewalDate}`,
        category: "insurance",
        urgency: days <= 3 ? "critical" : days <= 14 ? "high" : "medium",
        title: `${policy.policyType || "Insurance"} renewal is approaching`,
        body: `Your renewal is due in ${Math.max(0, days)} days. Review the premium, limits, deductibles, and available quotes before it renews.`,
        actionLabel: "Review policy",
        actionPath: "/insurance",
        expiresAt: policy.renewalDate,
        estimatedDollarImpact: n(policy.premiumIncrease),
      });
    }

    if (n(policy.premiumIncrease) >= 100) {
      candidates.push({
        id: `insurance-increase-${policy.policyType || "policy"}`,
        dedupeKey: `insurance:increase:${policy.policyType}:${Math.round(n(policy.premiumIncrease) / 50) * 50}`,
        category: "insurance",
        urgency: n(policy.premiumIncrease) >= 500 ? "high" : "medium",
        title: `${policy.policyType || "Insurance"} premium increased`,
        body: `The latest premium is about $${Math.round(n(policy.premiumIncrease))} higher. Confirm whether coverage changed and compare alternatives.`,
        actionLabel: "Compare coverage",
        actionPath: "/insurance",
        estimatedDollarImpact: n(policy.premiumIncrease),
      });
    }
  }

  const credit = input.credit;
  if (credit) {
    const utilization = n(credit.utilization);
    const previous = n(credit.previousUtilization);
    if (utilization > 30 || (previous > 0 && utilization - previous >= 10)) {
      candidates.push({
        id: "credit-utilization-change",
        dedupeKey: `credit:utilization:${Math.floor(utilization / 10) * 10}`,
        category: "credit",
        urgency: utilization >= 70 ? "high" : "medium",
        title: "Your reported card utilization changed",
        body: `Utilization is about ${Math.round(utilization)}%. Paying balances before statement closing dates can improve the next reported level.`,
        actionLabel: "Review cards",
        actionPath: "/debts",
      });
    }
  }

  for (const goal of input.goals ?? []) {
    const target = n(goal.target);
    const current = n(goal.current);
    if (target <= 0) continue;
    const progress = Math.min(1, current / target);
    const previousProgress = Math.min(1, n(goal.previousCurrent) / target);

    if (progress >= 1) {
      candidates.push({
        id: `goal-complete-${goal.id}`,
        dedupeKey: `goal:complete:${goal.id}`,
        category: "goal",
        urgency: "medium",
        title: `${goal.name} is complete`,
        body: `You reached your $${Math.round(target)} target. Choose the next destination for the money that was funding this goal.`,
        actionLabel: "Set next goal",
        actionPath: "/goals",
      });
    } else if (progress >= 0.75 && previousProgress < 0.75) {
      candidates.push({
        id: `goal-milestone-${goal.id}`,
        dedupeKey: `goal:75:${goal.id}`,
        category: "goal",
        urgency: "low",
        title: `${goal.name} is within reach`,
        body: `You are ${Math.round(progress * 100)}% complete. About $${Math.round(target - current)} remains.`,
        actionLabel: "View goal",
        actionPath: "/goals",
      });
    }
  }

  for (const document of input.expiringDocuments ?? []) {
    const days = daysUntil(document.expiresAt);
    if (days === null || days > 60) continue;
    candidates.push({
      id: `document-expiry-${document.id}`,
      dedupeKey: `document:expiry:${document.id}:${document.expiresAt}`,
      category: "document",
      urgency: days <= 3 ? "critical" : days <= 14 ? "high" : "medium",
      title: `${document.type} needs attention soon`,
      body: `${document.type} expires in ${Math.max(0, days)} days. Start the renewal or replacement process before it becomes urgent.`,
      actionLabel: "Open document",
      actionPath: "/documents",
      expiresAt: document.expiresAt,
    });
  }

  return candidates;
}
