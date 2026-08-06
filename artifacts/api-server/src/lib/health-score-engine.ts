/**
 * Financial Health Score Engine — Blue Collar AI
 *
 * Pure function: takes financial data, returns a 0-100 score with per-category
 * subscores, explanations, confidence, and a single highest-priority recommendation.
 *
 * Rules:
 * - Never score missing data as zero.
 * - Missing categories reduce confidence, not score.
 * - Score = earned points / max possible points (for categories with data), scaled 0-100.
 * - Confidence = sum of max weights for categories with data / 100.
 */

// ─── Inputs ───────────────────────────────────────────────────────────────────

export type HealthScoreInput = {
  /** Latest monthly net take-home pay. Null if no paystub. */
  monthlyNetIncome: number | null;
  /** Number of paystubs on file (for income stability scoring). */
  paystubCount: number;

  /** Total confirmed monthly bills (utilities, subscriptions, etc.). */
  monthlyBills: number | null;
  /** Total confirmed monthly minimum debt payments. */
  monthlyDebtPayments: number | null;

  /** Total cash / checking / savings balance. */
  cash: number | null;
  /** Total non-retirement investment balance. */
  investments: number | null;
  /** Total retirement account balance (401k, IRA, pension, etc.). */
  retirement: number | null;

  /** Total debt balance (all debts, revolving + installment). */
  totalDebt: number | null;
  /** Debt balance on accounts with APR ≥10%. */
  highInterestDebt: number | null;
  /** Revolving utilization 0–100 (%). Null if no revolving credit. */
  creditUtilization: number | null;

  /** True if the user has run and saved at least one tax estimate. */
  hasTaxEstimate: boolean;
  /** Days since the last tax estimate was saved. Null if none. */
  taxEstimateAgeDays: number | null;

  /** True if any insurance policy is recorded (bill, document, or asset). */
  hasInsurance: boolean;

  /** 0–100: what % of core data (income, bills, debt, cash, investments) is filled. */
  documentCompletionPct: number;
};

// ─── Outputs ──────────────────────────────────────────────────────────────────

export type CategoryStatus = "excellent" | "good" | "fair" | "needs_work" | "missing";

export type HealthCategory = {
  key: string;
  label: string;
  /** Points earned in this category. */
  score: number;
  /** Maximum possible points for this category. */
  maxScore: number;
  /** score / maxScore × 100 (0–100). */
  pct: number;
  /** Qualitative bucket. "missing" when no data is available. */
  status: CategoryStatus;
  /** Human-readable explanation of why this score was given. */
  explanation: string;
  /** True if this category has real data to score against. */
  hasData: boolean;
};

export type HealthRecommendation = {
  /** Category key of the recommended action. */
  category: string;
  title: string;
  detail: string;
  route: string;
};

export type HealthScoreResult = {
  /** Projected 0–100 score (scaled to what we have data for). Null if zero data. */
  score: number | null;
  /** Raw earned points (not scaled). */
  rawScore: number;
  /** Max possible points from categories with data. */
  maxPossible: number;
  /**
   * 0–100: what percentage of the total possible score weight we have data for.
   * 100 = full picture; 40 = only 40 pts worth of categories have data.
   */
  confidence: number;
  categories: HealthCategory[];
  recommendation: HealthRecommendation;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(score: number, max: number): number {
  return max === 0 ? 0 : Math.round((score / max) * 100);
}

function status(p: number, hasData: boolean): CategoryStatus {
  if (!hasData) return "missing";
  if (p >= 85) return "excellent";
  if (p >= 65) return "good";
  if (p >= 40) return "fair";
  return "needs_work";
}

function cat(
  key: string,
  label: string,
  score: number,
  maxScore: number,
  hasData: boolean,
  explanation: string,
): HealthCategory {
  const p = pct(score, maxScore);
  return { key, label, score, maxScore, pct: p, status: status(p, hasData), explanation, hasData };
}

// ─── Category scorers ─────────────────────────────────────────────────────────

function scoreCashFlow(input: HealthScoreInput): HealthCategory {
  const MAX = 20;
  const { monthlyNetIncome, monthlyBills, monthlyDebtPayments } = input;
  if (monthlyNetIncome === null) {
    return cat("cash_flow", "Cash Flow", 0, MAX, false,
      "Add a paystub to calculate your monthly cash flow.");
  }

  const expenses = (monthlyBills ?? 0) + (monthlyDebtPayments ?? 0);
  const surplus = monthlyNetIncome - expenses;
  const ratio = monthlyNetIncome > 0 ? surplus / monthlyNetIncome : 0;

  if (ratio >= 0.30) return cat("cash_flow", "Cash Flow", MAX, MAX, true,
    `You keep ${Math.round(ratio * 100)}% of take-home as surplus — excellent margin.`);
  if (ratio >= 0.20) return cat("cash_flow", "Cash Flow", 17, MAX, true,
    `You retain ${Math.round(ratio * 100)}% of take-home after bills and debt — solid.`);
  if (ratio >= 0.10) return cat("cash_flow", "Cash Flow", 13, MAX, true,
    `Cash flow is positive but tight at ${Math.round(ratio * 100)}% surplus.`);
  if (ratio > 0) return cat("cash_flow", "Cash Flow", 8, MAX, true,
    "Your surplus is very thin. One unexpected expense could cause a shortfall.");
  if (surplus === 0) return cat("cash_flow", "Cash Flow", 5, MAX, true,
    "Income covers bills exactly. There is no buffer for savings or emergencies.");
  return cat("cash_flow", "Cash Flow", 3, MAX, true,
    `Bills and debt exceed take-home by $${Math.abs(Math.round(surplus)).toLocaleString()}/month.`);
}

function scoreEmergencyFund(input: HealthScoreInput): HealthCategory {
  const MAX = 15;
  const { cash, monthlyBills, monthlyDebtPayments, monthlyNetIncome } = input;
  if (cash === null) {
    return cat("emergency_fund", "Emergency Fund", 0, MAX, false,
      "Add a bank or savings account to calculate emergency fund coverage.");
  }

  const expenses = (monthlyBills ?? 0) + (monthlyDebtPayments ?? 0) ||
    (monthlyNetIncome ?? 0) * 0.7; // fallback: 70% of income as estimated expenses
  const months = expenses > 0 ? cash / expenses : 0;

  if (months >= 6) return cat("emergency_fund", "Emergency Fund", MAX, MAX, true,
    `${months.toFixed(1)} months of expenses covered — the gold standard.`);
  if (months >= 3) return cat("emergency_fund", "Emergency Fund", 11, MAX, true,
    `${months.toFixed(1)} months covered. Work toward 6 months for full protection.`);
  if (months >= 1) return cat("emergency_fund", "Emergency Fund", 7, MAX, true,
    `${months.toFixed(1)} month${months < 1.5 ? "" : "s"} covered. Target 3–6 months.`);
  if (months > 0) return cat("emergency_fund", "Emergency Fund", 4, MAX, true,
    "Less than 1 month of expenses saved. A missed paycheck could cause serious strain.");
  return cat("emergency_fund", "Emergency Fund", 2, MAX, true,
    "No cash balance on record. Even a $500 starter fund provides a meaningful buffer.");
}

function scoreDebt(input: HealthScoreInput): HealthCategory {
  const MAX = 15;
  const { totalDebt, highInterestDebt, monthlyNetIncome } = input;
  if (totalDebt === null) {
    return cat("debt", "Debt Management", 0, MAX, false,
      "Add any debts or loans to score this category.");
  }

  if (totalDebt === 0) return cat("debt", "Debt Management", MAX, MAX, true, "No debt on record — excellent.");

  const annualIncome = (monthlyNetIncome ?? 0) * 12;
  const dti = annualIncome > 0 ? totalDebt / annualIncome : 1;
  const hiDebt = highInterestDebt ?? 0;

  if (hiDebt === 0 && dti < 0.10) return cat("debt", "Debt Management", 13, MAX, true,
    `No high-interest debt and debt-to-income ratio is ${Math.round(dti * 100)}% — strong position.`);
  if (dti < 0.20) return cat("debt", "Debt Management", 10, MAX, true,
    `Debt is ${Math.round(dti * 100)}% of annual income. Focus on any high-APR balances first.`);
  if (dti < 0.30) return cat("debt", "Debt Management", 7, MAX, true,
    `Debt is ${Math.round(dti * 100)}% of annual income — manageable but worth reducing.`);
  if (dti < 0.50) return cat("debt", "Debt Management", 4, MAX, true,
    `Debt is ${Math.round(dti * 100)}% of annual income. Prioritize paying down high-interest balances.`);
  return cat("debt", "Debt Management", 2, MAX, true,
    `High debt load — ${Math.round(dti * 100)}% of annual income. A debt payoff plan is critical.`);
}

function scoreCreditUtilization(input: HealthScoreInput): HealthCategory {
  const MAX = 10;
  const { creditUtilization } = input;
  if (creditUtilization === null) {
    return cat("credit_utilization", "Credit Utilization", 0, MAX, false,
      "Add credit card accounts with limits to score this category.");
  }

  const u = creditUtilization;
  if (u <= 10) return cat("credit_utilization", "Credit Utilization", MAX, MAX, true,
    `${Math.round(u)}% utilization — optimal for your credit score.`);
  if (u <= 30) return cat("credit_utilization", "Credit Utilization", 7, MAX, true,
    `${Math.round(u)}% utilization — good. Under 30% keeps most credit scores healthy.`);
  if (u <= 50) return cat("credit_utilization", "Credit Utilization", 4, MAX, true,
    `${Math.round(u)}% utilization — elevated. Paying down balances before the statement date helps.`);
  if (u <= 75) return cat("credit_utilization", "Credit Utilization", 2, MAX, true,
    `${Math.round(u)}% utilization is high and is likely hurting your credit score.`);
  return cat("credit_utilization", "Credit Utilization", 1, MAX, true,
    `${Math.round(u)}% utilization is very high. Paying down revolving balances is the priority.`);
}

function scoreInvestments(input: HealthScoreInput): HealthCategory {
  const MAX = 10;
  const { investments } = input;
  if (investments === null) {
    return cat("investments", "Investments", 0, MAX, false,
      "Add brokerage or investment accounts to score this category.");
  }

  if (investments > 50_000) return cat("investments", "Investments", MAX, MAX, true,
    `$${(investments / 1000).toFixed(0)}k in non-retirement investments — well positioned.`);
  if (investments > 10_000) return cat("investments", "Investments", 8, MAX, true,
    `$${(investments / 1000).toFixed(0)}k invested. Keep adding to grow compound growth.`);
  if (investments > 1_000) return cat("investments", "Investments", 5, MAX, true,
    `$${investments.toLocaleString()} invested — a solid start. Consistent contributions build wealth.`);
  if (investments > 0) return cat("investments", "Investments", 3, MAX, true,
    `Small investment balance recorded. Any amount invested is better than none.`);
  return cat("investments", "Investments", 1, MAX, true,
    "Investment account on file but balance is zero. Start with any amount you can spare.");
}

function scoreRetirement(input: HealthScoreInput): HealthCategory {
  const MAX = 10;
  const { retirement } = input;
  if (retirement === null) {
    return cat("retirement", "Retirement", 0, MAX, false,
      "Add a 401(k), IRA, or pension account to score this category.");
  }

  if (retirement > 100_000) return cat("retirement", "Retirement", MAX, MAX, true,
    `$${(retirement / 1000).toFixed(0)}k in retirement savings — excellent foundation.`);
  if (retirement > 50_000) return cat("retirement", "Retirement", 8, MAX, true,
    `$${(retirement / 1000).toFixed(0)}k saved for retirement. Keep contributing consistently.`);
  if (retirement > 10_000) return cat("retirement", "Retirement", 6, MAX, true,
    `$${(retirement / 1000).toFixed(0)}k in retirement accounts — growing. Capture any employer match.`);
  if (retirement > 0) return cat("retirement", "Retirement", 4, MAX, true,
    `Retirement savings started at $${retirement.toLocaleString()}. Consistency is key.`);
  return cat("retirement", "Retirement", 2, MAX, true,
    "Retirement account on file but balance is zero. Contribute enough to capture any employer match.");
}

function scoreTaxReadiness(input: HealthScoreInput): HealthCategory {
  const MAX = 5;
  const { hasTaxEstimate, taxEstimateAgeDays } = input;

  if (!hasTaxEstimate) return cat("tax_readiness", "Tax Readiness", 1, MAX, true,
    "Run and save a tax estimate to check whether withholding is on track.");
  if (taxEstimateAgeDays !== null && taxEstimateAgeDays <= 30) return cat("tax_readiness", "Tax Readiness", MAX, MAX, true,
    "Tax estimate is current — withholding check is up to date.");
  if (taxEstimateAgeDays !== null && taxEstimateAgeDays <= 90) return cat("tax_readiness", "Tax Readiness", 4, MAX, true,
    "Tax estimate is a few months old. Refresh it if your income or filing status changed.");
  return cat("tax_readiness", "Tax Readiness", 3, MAX, true,
    "Tax estimate is on file but may be outdated. Run a new one before year-end.");
}

function scoreInsurance(input: HealthScoreInput): HealthCategory {
  const MAX = 5;
  const { hasInsurance } = input;

  if (hasInsurance) return cat("insurance", "Insurance", MAX, MAX, true,
    "Insurance coverage is on record.");
  return cat("insurance", "Insurance", 1, MAX, true,
    "No insurance records found. Scan a policy or add coverage details to score this.");
}

function scoreIncomeStability(input: HealthScoreInput): HealthCategory {
  const MAX = 5;
  const { paystubCount } = input;

  if (paystubCount === 0) {
    return cat("income_stability", "Income Stability", 0, MAX, false,
      "Upload at least one paystub to score income stability.");
  }
  if (paystubCount >= 4) return cat("income_stability", "Income Stability", MAX, MAX, true,
    `${paystubCount} paystubs on file — consistent income history.`);
  if (paystubCount >= 2) return cat("income_stability", "Income Stability", 3, MAX, true,
    `${paystubCount} paystubs on file. Upload more to strengthen your income history.`);
  return cat("income_stability", "Income Stability", 2, MAX, true,
    "Only 1 paystub on file. Adding more shows a pattern of consistent income.");
}

function scoreDocumentCompletion(input: HealthScoreInput): HealthCategory {
  const MAX = 5;
  const { documentCompletionPct } = input;
  const p = Math.round(documentCompletionPct);

  if (p >= 80) return cat("document_completion", "Profile Completion", MAX, MAX, true,
    `${p}% of your financial profile is complete — the dashboard is highly accurate.`);
  if (p >= 60) return cat("document_completion", "Profile Completion", 4, MAX, true,
    `${p}% complete. Add bills, debts, or investments for a fuller picture.`);
  if (p >= 40) return cat("document_completion", "Profile Completion", 3, MAX, true,
    `${p}% complete. More data means more accurate scores and recommendations.`);
  if (p >= 20) return cat("document_completion", "Profile Completion", 2, MAX, true,
    `${p}% complete. Start by scanning a paystub or adding your bank balance.`);
  return cat("document_completion", "Profile Completion", 1, MAX, true,
    "Very little data on file. Scan any financial document to get started.");
}

// ─── Recommendation ───────────────────────────────────────────────────────────

const RECOMMENDATIONS: Record<string, HealthRecommendation> = {
  cash_flow: {
    category: "cash_flow",
    title: "Close the monthly cash-flow gap",
    detail: "Your bills and debt payments are outpacing take-home pay. Review recurring bills first.",
    route: "/bills",
  },
  emergency_fund: {
    category: "emergency_fund",
    title: "Build your emergency fund",
    detail: "Target 1 month of expenses first, then grow to 3–6 months over time.",
    route: "/banking",
  },
  debt: {
    category: "debt",
    title: "Attack high-interest debt",
    detail: "Direct extra cash toward your highest-APR balance using the avalanche method.",
    route: "/debts",
  },
  credit_utilization: {
    category: "credit_utilization",
    title: "Lower credit utilization below 30%",
    detail: "Pay revolving balances before the statement date to improve reported utilization.",
    route: "/debts",
  },
  investments: {
    category: "investments",
    title: "Start or grow your investment account",
    detail: "Even small, consistent contributions build significant wealth through compounding.",
    route: "/investments",
  },
  retirement: {
    category: "retirement",
    title: "Capture your full employer match",
    detail: "Contribute at least enough to receive every matching dollar — it is an instant return.",
    route: "/investments",
  },
  tax_readiness: {
    category: "tax_readiness",
    title: "Run and save a tax estimate",
    detail: "A current estimate shows whether withholding will leave you owing or getting a refund.",
    route: "/tax-estimator",
  },
  insurance: {
    category: "insurance",
    title: "Record your insurance coverage",
    detail: "Scan a policy document or add coverage details so your protection is tracked.",
    route: "/scanner",
  },
  income_stability: {
    category: "income_stability",
    title: "Upload more paystubs",
    detail: "Multiple paystubs give the dashboard a reliable income trend to work from.",
    route: "/scanner",
  },
  document_completion: {
    category: "document_completion",
    title: "Finish your financial profile",
    detail: "Add bills, debt, cash, and investment information for accurate scores.",
    route: "/scanner",
  },
};

function chooseRecommendation(categories: HealthCategory[]): HealthRecommendation {
  // From filled categories, find lowest pct
  const filled = categories.filter((c) => c.hasData);
  if (filled.length === 0) {
    return RECOMMENDATIONS.document_completion;
  }
  const worst = filled.reduce((a, b) => (a.pct <= b.pct ? a : b));
  return RECOMMENDATIONS[worst.key] ?? RECOMMENDATIONS.document_completion;
}

// ─── Main function ─────────────────────────────────────────────────────────────

/**
 * "Core" financial categories — at least one must have data before we show a score.
 * The "always-on" categories (tax readiness, insurance, document completion) are
 * behavioural signals that are always present, but by themselves do not constitute
 * meaningful financial data. We match the UX expectation: score = null until the
 * user has added at least some real financial information.
 */
const CORE_CATEGORY_KEYS = new Set([
  "cash_flow",
  "emergency_fund",
  "debt",
  "credit_utilization",
  "investments",
  "retirement",
  "income_stability",
]);

export function computeHealthScore(input: HealthScoreInput): HealthScoreResult {
  const categories: HealthCategory[] = [
    scoreCashFlow(input),
    scoreEmergencyFund(input),
    scoreDebt(input),
    scoreCreditUtilization(input),
    scoreInvestments(input),
    scoreRetirement(input),
    scoreTaxReadiness(input),
    scoreInsurance(input),
    scoreIncomeStability(input),
    scoreDocumentCompletion(input),
  ];

  const filled = categories.filter((c) => c.hasData);
  const rawScore = filled.reduce((sum, c) => sum + c.score, 0);
  const maxPossible = filled.reduce((sum, c) => sum + c.maxScore, 0);
  // Total weight of all categories is 100. confidence = how much of that weight has data.
  const allMax = categories.reduce((sum, c) => sum + c.maxScore, 0); // = 100
  const confidence = Math.round((maxPossible / allMax) * 100);

  // Only compute a score when at least one core financial category has data.
  // "Always-on" behavioural categories (tax, insurance, document completion) alone
  // do not constitute enough to show a meaningful score.
  const hasCoreData = categories.some((c) => CORE_CATEGORY_KEYS.has(c.key) && c.hasData);
  const score = hasCoreData && maxPossible > 0
    ? Math.max(0, Math.min(100, Math.round((rawScore / maxPossible) * 100)))
    : null;

  return {
    score,
    rawScore,
    maxPossible,
    confidence,
    categories,
    recommendation: chooseRecommendation(categories),
  };
}
