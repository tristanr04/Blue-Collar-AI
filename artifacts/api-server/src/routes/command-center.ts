import { Router, type IRouter } from "express";

const router: IRouter = Router();

type CommandCenterInput = {
  cash?: number;
  monthlyTakeHome?: number;
  monthlyExpenses?: number;
  totalDebt?: number;
  highInterestDebt?: number;
  investments?: number;
  retirement?: number;
  creditUtilization?: number;
  emergencyFundTargetMonths?: number;
  projectedTaxRefund?: number;
  projectedTaxOwed?: number;
  insuranceRenewalDays?: number;
  upcomingBills?: Array<{ name: string; amount: number; dueDate: string }>;
  goals?: Array<{ name: string; current: number; target: number }>;
  previous?: {
    cash?: number;
    debt?: number;
    investments?: number;
    retirement?: number;
    spending?: number;
  };
};

type BestMove = {
  id: string;
  title: string;
  reason: string;
  action: string;
  estimatedMonthlyImpact?: number;
  estimatedAnnualImpact?: number;
  priority: number;
  difficulty: "easy" | "moderate" | "hard";
};

function n(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function buildMoves(input: CommandCenterInput): BestMove[] {
  const cash = n(input.cash);
  const expenses = n(input.monthlyExpenses);
  const income = n(input.monthlyTakeHome);
  const highInterestDebt = n(input.highInterestDebt);
  const utilization = n(input.creditUtilization);
  const targetMonths = n(input.emergencyFundTargetMonths) || 3;
  const emergencyTarget = expenses * targetMonths;
  const moves: BestMove[] = [];

  if (expenses > 0 && cash < emergencyTarget) {
    const gap = emergencyTarget - cash;
    const monthly = Math.max(25, Math.min(gap, income > expenses ? (income - expenses) * 0.5 : gap / 12));
    moves.push({
      id: "emergency-fund",
      title: "Strengthen your emergency cushion",
      reason: `You currently have about ${expenses ? (cash / expenses).toFixed(1) : "0"} months of core expenses available.`,
      action: `Redirect about $${Math.round(monthly)} per month until the cushion reaches $${Math.round(emergencyTarget)}.`,
      estimatedMonthlyImpact: monthly,
      estimatedAnnualImpact: monthly * 12,
      priority: cash < expenses ? 100 : 78,
      difficulty: monthly < 150 ? "easy" : "moderate",
    });
  }

  if (highInterestDebt > 0) {
    const monthly = Math.max(50, Math.min(highInterestDebt, Math.max(0, income - expenses) * 0.5 || 100));
    moves.push({
      id: "high-interest-debt",
      title: "Put extra cash toward costly debt",
      reason: "High-interest balances can slow every other financial goal.",
      action: `Add about $${Math.round(monthly)} to the highest-rate balance this month.`,
      estimatedMonthlyImpact: monthly,
      estimatedAnnualImpact: monthly * 12,
      priority: 92,
      difficulty: monthly < 200 ? "easy" : "moderate",
    });
  }

  if (utilization > 30) {
    moves.push({
      id: "credit-utilization",
      title: "Lower reported card balances",
      reason: `Your reported utilization is about ${Math.round(utilization)}%.`,
      action: "Pay balances down before statement closing dates and keep new charges controlled until utilization is under 30%.",
      priority: utilization > 70 ? 90 : 72,
      difficulty: "moderate",
    });
  }

  if (input.insuranceRenewalDays !== undefined && input.insuranceRenewalDays <= 30) {
    moves.push({
      id: "insurance-renewal",
      title: "Review your insurance before renewal",
      reason: `Your renewal is due in ${Math.max(0, input.insuranceRenewalDays)} days.`,
      action: "Upload the renewal notice, confirm coverage limits and deductibles, and compare quotes before the renewal date.",
      priority: 74,
      difficulty: "easy",
    });
  }

  if (n(input.projectedTaxOwed) > 0) {
    const owed = n(input.projectedTaxOwed);
    moves.push({
      id: "tax-withholding",
      title: "Close the projected tax gap",
      reason: `The current estimate shows about $${Math.round(owed)} potentially owed.`,
      action: "Review withholding and projected overtime before the next paycheck so the gap does not keep growing.",
      estimatedAnnualImpact: owed,
      priority: 88,
      difficulty: "easy",
    });
  }

  if (!moves.length) {
    const monthly = Math.max(25, Math.min(250, Math.max(0, income - expenses) * 0.25));
    moves.push({
      id: "build-momentum",
      title: "Keep your momentum compounding",
      reason: "No urgent financial gap was detected from the available data.",
      action: `Direct an extra $${Math.round(monthly)} this month toward your highest-priority savings, debt, or retirement goal.`,
      estimatedMonthlyImpact: monthly,
      estimatedAnnualImpact: monthly * 12,
      priority: 50,
      difficulty: "easy",
    });
  }

  return moves.sort((a, b) => b.priority - a.priority);
}

function buildWins(input: CommandCenterInput): string[] {
  const wins: string[] = [];
  const previous = input.previous;
  if (!previous) return wins;
  if (n(input.cash) > n(previous.cash)) wins.push(`Cash increased by $${Math.round(n(input.cash) - n(previous.cash))}.`);
  if (n(input.totalDebt) < n(previous.debt)) wins.push(`Debt dropped by $${Math.round(n(previous.debt) - n(input.totalDebt))}.`);
  if (n(input.investments) > n(previous.investments)) wins.push(`Investments grew by $${Math.round(n(input.investments) - n(previous.investments))}.`);
  if (n(input.retirement) > n(previous.retirement)) wins.push(`Retirement savings increased by $${Math.round(n(input.retirement) - n(previous.retirement))}.`);
  return wins.slice(0, 5);
}

router.post("/command-center/summary", (req, res) => {
  const input = (req.body ?? {}) as CommandCenterInput;
  const cash = n(input.cash);
  const expenses = n(input.monthlyExpenses);
  const income = n(input.monthlyTakeHome);
  const debt = n(input.totalDebt);
  const investments = n(input.investments);
  const retirement = n(input.retirement);
  const utilization = n(input.creditUtilization);
  const emergencyMonths = expenses > 0 ? cash / expenses : 0;

  const emergencyScore = clamp((emergencyMonths / (n(input.emergencyFundTargetMonths) || 3)) * 100);
  const debtScore = clamp(debt === 0 ? 100 : 100 - (debt / Math.max(income * 12, 1)) * 60);
  const creditScore = clamp(utilization <= 10 ? 100 : utilization <= 30 ? 82 : 100 - utilization);
  const cashFlowScore = clamp(income > 0 ? ((income - expenses) / income) * 200 + 50 : 40);
  const healthScore = Math.round(emergencyScore * 0.3 + debtScore * 0.25 + creditScore * 0.2 + cashFlowScore * 0.25);
  const moves = buildMoves(input);

  res.json({
    generatedAt: new Date().toISOString(),
    healthScore,
    snapshot: {
      netWorth: cash + investments + retirement - debt,
      cashAvailable: cash,
      emergencyFundMonths: Number(emergencyMonths.toFixed(1)),
      creditUtilization: utilization,
      projectedTaxRefund: n(input.projectedTaxRefund),
      projectedTaxOwed: n(input.projectedTaxOwed),
      insuranceStatus: input.insuranceRenewalDays !== undefined && input.insuranceRenewalDays <= 30 ? "review_due" : "no_immediate_action",
    },
    nextBestMove: moves[0],
    opportunities: moves.slice(1, 5),
    wins: buildWins(input),
    upcoming: [...(input.upcomingBills ?? [])]
      .filter(item => item?.name && item?.dueDate)
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
      .slice(0, 8),
    goals: (input.goals ?? []).map(goal => ({
      ...goal,
      progressPercent: goal.target > 0 ? Math.round(clamp((goal.current / goal.target) * 100)) : 0,
    })),
    dataQuality: {
      complete: income > 0 && expenses > 0,
      missing: [
        income <= 0 ? "monthlyTakeHome" : null,
        expenses <= 0 ? "monthlyExpenses" : null,
      ].filter(Boolean),
    },
  });
});

export default router;
