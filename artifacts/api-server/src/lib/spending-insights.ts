export type SpendingCategory =
  | "housing"
  | "utilities"
  | "transportation"
  | "groceries"
  | "dining"
  | "shopping"
  | "entertainment"
  | "subscriptions"
  | "travel"
  | "health"
  | "insurance"
  | "debt"
  | "savings"
  | "investing"
  | "income"
  | "other";

export type SpendingTransaction = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category: SpendingCategory;
  isRecurring?: boolean;
  isEssential?: boolean;
};

export type SpendingProfile = {
  monthlyNetIncome: number;
  emergencyFund: number;
  monthlyEssentialExpenses: number;
  highInterestDebtBalance: number;
  savingsGoalMonthly?: number;
  investingGoalMonthly?: number;
};

export type SpendingInsight = {
  id: string;
  priority: "celebrate" | "notice" | "action" | "urgent";
  category: SpendingCategory | "overall";
  title: string;
  message: string;
  nextStep: string;
  monthlyImpact: number;
  annualImpact: number;
  evidence: string[];
};

export type SpendingAnalysis = {
  period: { start: string; end: string };
  totalSpent: number;
  discretionarySpent: number;
  discretionaryRate: number;
  categoryTotals: Partial<Record<SpendingCategory, number>>;
  insights: SpendingInsight[];
  topNextAction: SpendingInsight | null;
};

const DISCRETIONARY = new Set<SpendingCategory>([
  "dining",
  "shopping",
  "entertainment",
  "subscriptions",
  "travel",
]);

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function safeAmount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function monthKey(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "unknown";
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getPeriod(transactions: SpendingTransaction[]) {
  const valid = transactions
    .map(transaction => new Date(transaction.date))
    .filter(date => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const now = new Date();
  return {
    start: (valid[0] ?? now).toISOString(),
    end: (valid[valid.length - 1] ?? now).toISOString(),
  };
}

function buildConsumerismInsight(
  discretionarySpent: number,
  monthlyNetIncome: number,
  categoryTotals: Partial<Record<SpendingCategory, number>>,
): SpendingInsight | null {
  if (monthlyNetIncome <= 0 || discretionarySpent <= 0) return null;

  const rate = discretionarySpent / monthlyNetIncome;
  if (rate < 0.2) return null;

  const targetRate = rate >= 0.4 ? 0.2 : 0.15;
  const suggestedReduction = Math.max(25, discretionarySpent - monthlyNetIncome * targetRate);
  const topCategories = ["shopping", "dining", "entertainment", "subscriptions", "travel"]
    .map(category => ({ category: category as SpendingCategory, amount: categoryTotals[category as SpendingCategory] ?? 0 }))
    .filter(entry => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);

  const evidence = topCategories.map(entry => `${entry.category}: $${roundMoney(entry.amount)}`);
  const priority = rate >= 0.5 ? "urgent" : rate >= 0.35 ? "action" : "notice";

  return {
    id: "consumerism-pattern",
    priority,
    category: "overall",
    title: "Your spending has room to work harder for you",
    message: `About ${Math.round(rate * 100)}% of take-home pay went toward flexible spending this period. That does not mean you failed—it means there is a clear opportunity to redirect part of it toward your goals.`,
    nextStep: `Try a 30-day redirect of $${roundMoney(suggestedReduction)} from shopping, dining, entertainment, subscriptions, or travel into your highest-priority goal.`,
    monthlyImpact: roundMoney(suggestedReduction),
    annualImpact: roundMoney(suggestedReduction * 12),
    evidence,
  };
}

function buildSubscriptionInsight(transactions: SpendingTransaction[]): SpendingInsight | null {
  const recurring = transactions.filter(transaction => transaction.category === "subscriptions" || transaction.isRecurring);
  const total = recurring.reduce((sum, transaction) => sum + safeAmount(transaction.amount), 0);
  if (total < 40 || recurring.length < 2) return null;

  const sorted = [...recurring].sort((a, b) => b.amount - a.amount).slice(0, 5);
  const suggestedReduction = Math.max(10, total * 0.25);
  return {
    id: "subscription-review",
    priority: total >= 150 ? "action" : "notice",
    category: "subscriptions",
    title: "A quick subscription review could free up cash",
    message: `Recurring charges totaled $${roundMoney(total)} this period. A small cleanup could improve monthly cash flow without changing the bigger parts of your lifestyle.`,
    nextStep: "Review the recurring list and pause, downgrade, or cancel anything you would not actively buy again today.",
    monthlyImpact: roundMoney(suggestedReduction),
    annualImpact: roundMoney(suggestedReduction * 12),
    evidence: sorted.map(transaction => `${transaction.merchant}: $${roundMoney(transaction.amount)}`),
  };
}

function buildDiningInsight(total: number, monthlyNetIncome: number): SpendingInsight | null {
  if (total < 150 || monthlyNetIncome <= 0 || total / monthlyNetIncome < 0.06) return null;
  const reduction = Math.max(30, total * 0.2);
  return {
    id: "dining-pattern",
    priority: total / monthlyNetIncome >= 0.12 ? "action" : "notice",
    category: "dining",
    title: "Dining spending is one of your easiest adjustment levers",
    message: `Dining and takeout reached $${roundMoney(total)} this period. You do not need to cut it out—just giving it a planned limit can create immediate breathing room.`,
    nextStep: `Set next month's dining target near $${roundMoney(total - reduction)} and move the difference automatically toward savings or debt.`,
    monthlyImpact: roundMoney(reduction),
    annualImpact: roundMoney(reduction * 12),
    evidence: [`Current dining total: $${roundMoney(total)}`],
  };
}

function buildSavingsMomentum(profile: SpendingProfile, transactions: SpendingTransaction[]): SpendingInsight | null {
  const saved = transactions
    .filter(transaction => transaction.category === "savings" || transaction.category === "investing")
    .reduce((sum, transaction) => sum + safeAmount(transaction.amount), 0);
  if (saved <= 0) return null;

  return {
    id: "savings-momentum",
    priority: "celebrate",
    category: "savings",
    title: "You are already building momentum",
    message: `You directed $${roundMoney(saved)} toward savings or investing this period. Keeping that automatic is one of the strongest habits in your plan.`,
    nextStep: profile.highInterestDebtBalance > 0
      ? "Keep the habit, then direct the next available increase toward high-interest debt."
      : "Keep the automation and increase it slightly after your next raise, overtime week, or paid-off bill.",
    monthlyImpact: roundMoney(saved),
    annualImpact: roundMoney(saved * 12),
    evidence: [`Savings and investing transfers: $${roundMoney(saved)}`],
  };
}

function buildEmergencyFundInsight(profile: SpendingProfile): SpendingInsight | null {
  if (profile.monthlyEssentialExpenses <= 0) return null;
  const months = profile.emergencyFund / profile.monthlyEssentialExpenses;
  if (months >= 3) return null;

  const target = profile.monthlyEssentialExpenses * 3;
  const gap = Math.max(0, target - profile.emergencyFund);
  return {
    id: "emergency-fund-path",
    priority: months < 1 ? "action" : "notice",
    category: "savings",
    title: "Your next safety milestone is within reach",
    message: `Your current emergency cushion covers about ${roundMoney(months)} months of essentials. The next milestone is three months—not because you are behind, but because it gives you more control when work slows down or a major bill hits.`,
    nextStep: `Redirect the first $${roundMoney(Math.min(gap, Math.max(50, gap / 12)))} each month toward this cushion until the three-month target is complete.`,
    monthlyImpact: roundMoney(Math.min(gap, Math.max(50, gap / 12))),
    annualImpact: roundMoney(Math.min(gap, Math.max(50, gap / 12)) * 12),
    evidence: [`Current cushion: $${roundMoney(profile.emergencyFund)}`, `Three-month target: $${roundMoney(target)}`],
  };
}

export function analyzeSpending(
  transactions: SpendingTransaction[],
  profile: SpendingProfile,
): SpendingAnalysis {
  const categoryTotals: Partial<Record<SpendingCategory, number>> = {};
  const months = new Set<string>();

  for (const transaction of transactions) {
    const amount = safeAmount(transaction.amount);
    categoryTotals[transaction.category] = (categoryTotals[transaction.category] ?? 0) + amount;
    months.add(monthKey(transaction.date));
  }

  const monthCount = Math.max(1, [...months].filter(value => value !== "unknown").length);
  for (const category of Object.keys(categoryTotals) as SpendingCategory[]) {
    categoryTotals[category] = roundMoney((categoryTotals[category] ?? 0) / monthCount);
  }

  const totalSpent = roundMoney(
    Object.entries(categoryTotals)
      .filter(([category]) => category !== "income")
      .reduce((sum, [, amount]) => sum + safeAmount(amount ?? 0), 0),
  );

  const discretionarySpent = roundMoney(
    [...DISCRETIONARY].reduce((sum, category) => sum + safeAmount(categoryTotals[category] ?? 0), 0),
  );
  const discretionaryRate = profile.monthlyNetIncome > 0
    ? roundMoney((discretionarySpent / profile.monthlyNetIncome) * 100)
    : 0;

  const insights = [
    buildConsumerismInsight(discretionarySpent, profile.monthlyNetIncome, categoryTotals),
    buildSubscriptionInsight(transactions),
    buildDiningInsight(categoryTotals.dining ?? 0, profile.monthlyNetIncome),
    buildEmergencyFundInsight(profile),
    buildSavingsMomentum(profile, transactions),
  ].filter((insight): insight is SpendingInsight => Boolean(insight));

  const rank = { urgent: 4, action: 3, notice: 2, celebrate: 1 } as const;
  insights.sort((a, b) => rank[b.priority] - rank[a.priority] || b.monthlyImpact - a.monthlyImpact);

  return {
    period: getPeriod(transactions),
    totalSpent,
    discretionarySpent,
    discretionaryRate,
    categoryTotals,
    insights,
    topNextAction: insights.find(insight => insight.priority !== "celebrate") ?? insights[0] ?? null,
  };
}
