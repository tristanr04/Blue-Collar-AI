/**
 * Pure debt-payoff calculation engine.
 *
 * Supports four strategies:
 *   - avalanche:   highest-interest first (minimises total interest paid)
 *   - snowball:    lowest-balance first (maximises psychological wins)
 *   - utilization: highest utilisation first (improves credit score fastest)
 *   - custom:      caller-supplied priority order (array of debt IDs)
 *
 * All calculations are pure (no side effects, no DB access) so they are
 * easily unit-tested and run on-demand per request.
 */

export interface DebtInput {
  id: string;
  name: string;
  balance: number;          // current balance
  interestRate: number;     // annual percentage rate (e.g. 24.99 for 24.99%)
  minimumPayment: number;   // monthly minimum
  creditLimit?: number | null;
  isRevolving?: boolean;
}

export type PayoffStrategy = "avalanche" | "snowball" | "utilization" | "custom";

export interface PayoffPlanInput {
  debts: DebtInput[];
  strategy: PayoffStrategy;
  extraMonthlyPayment: number;
  customOrder?: string[]; // debt IDs for "custom" strategy
}

export interface MonthlyAllocation {
  debtId: string;
  payment: number;
  interestCharged: number;
  principalPaid: number;
  remainingBalance: number;
}

export interface PayoffMonth {
  month: number;
  totalPayment: number;
  totalInterest: number;
  allocations: MonthlyAllocation[];
}

export interface DebtPayoffSummary {
  debtId: string;
  name: string;
  originalBalance: number;
  totalInterestPaid: number;
  payoffMonth: number;
}

export interface PayoffSchedule {
  strategy: PayoffStrategy;
  totalMonths: number;
  totalInterestPaid: number;
  totalPaid: number;
  debtSummaries: DebtPayoffSummary[];
  months: PayoffMonth[];           // capped at 360 (30 years)
  truncated: boolean;
}

const MAX_MONTHS = 360;

/** Order debts by strategy. Returns IDs in priority order. */
function prioritize(
  debts: DebtInput[],
  strategy: PayoffStrategy,
  customOrder: string[],
): DebtInput[] {
  if (strategy === "avalanche") {
    return [...debts].sort((a, b) => b.interestRate - a.interestRate);
  }
  if (strategy === "snowball") {
    return [...debts].sort((a, b) => a.balance - b.balance);
  }
  if (strategy === "utilization") {
    // highest utilisation = highest balance/creditLimit ratio
    return [...debts].sort((a, b) => {
      const util = (d: DebtInput) =>
        d.creditLimit && d.creditLimit > 0 ? d.balance / d.creditLimit : 0;
      return util(b) - util(a);
    });
  }
  // custom: use supplied order; debts not in list go last
  const orderMap = new Map(customOrder.map((id, i) => [id, i]));
  return [...debts].sort(
    (a, b) => (orderMap.get(a.id) ?? 9999) - (orderMap.get(b.id) ?? 9999),
  );
}

export function calculatePayoffSchedule(input: PayoffPlanInput): PayoffSchedule {
  const { strategy, extraMonthlyPayment, customOrder = [] } = input;

  if (input.debts.length === 0) {
    return {
      strategy,
      totalMonths: 0,
      totalInterestPaid: 0,
      totalPaid: 0,
      debtSummaries: [],
      months: [],
      truncated: false,
    };
  }

  // Working state
  const balances = new Map<string, number>(
    input.debts.map((d) => [d.id, d.balance]),
  );
  const interestAccum = new Map<string, number>(
    input.debts.map((d) => [d.id, 0]),
  );
  const payoffMonth = new Map<string, number>();

  const priority = prioritize(input.debts, strategy, customOrder);
  const debtById = new Map(input.debts.map((d) => [d.id, d]));

  let totalInterestPaid = 0;
  let totalPaid = 0;
  const months: PayoffMonth[] = [];
  let truncated = false;

  for (let month = 1; month <= MAX_MONTHS; month++) {
    // All debts paid?
    if ([...balances.values()].every((b) => b <= 0)) break;

    // Compute interest charges first
    const interestThisMonth = new Map<string, number>();
    for (const debt of input.debts) {
      const bal = balances.get(debt.id) ?? 0;
      if (bal <= 0) continue;
      const monthly = (debt.interestRate / 100) / 12;
      interestThisMonth.set(debt.id, bal * monthly);
    }

    // Total available cash this month
    const totalMinPayments = input.debts.reduce((sum, d) => {
      const bal = balances.get(d.id) ?? 0;
      return bal > 0 ? sum + Math.min(d.minimumPayment, bal) : sum;
    }, 0);
    let extraPool = extraMonthlyPayment;

    const allocations: MonthlyAllocation[] = [];

    // Pay each debt: minimum + snowball extra goes to highest-priority
    for (const debt of priority) {
      const bal = balances.get(debt.id) ?? 0;
      if (bal <= 0) continue;

      const interest = interestThisMonth.get(debt.id) ?? 0;
      const newBal = bal + interest;
      const minPay = Math.min(debt.minimumPayment, newBal);

      // Apply extra only to the first (highest priority) unpaid debt
      let extra = 0;
      if (extraPool > 0 && !allocations.some((a) => a.payment > debtById.get(a.debtId)!.minimumPayment + 0.01)) {
        extra = Math.min(extraPool, newBal - minPay);
        extraPool -= extra;
      }

      const payment = Math.min(minPay + extra, newBal);
      const principalPaid = payment - interest;
      const remaining = Math.max(0, newBal - payment);

      balances.set(debt.id, remaining);
      const newAccum = (interestAccum.get(debt.id) ?? 0) + interest;
      interestAccum.set(debt.id, newAccum);

      totalInterestPaid += interest;
      totalPaid += payment;

      if (remaining <= 0 && !payoffMonth.has(debt.id)) {
        payoffMonth.set(debt.id, month);
      }

      allocations.push({
        debtId: debt.id,
        payment: Math.round(payment * 100) / 100,
        interestCharged: Math.round(interest * 100) / 100,
        principalPaid: Math.round(principalPaid * 100) / 100,
        remainingBalance: Math.round(remaining * 100) / 100,
      });
    }

    months.push({
      month,
      totalPayment: Math.round(allocations.reduce((s, a) => s + a.payment, 0) * 100) / 100,
      totalInterest: Math.round(allocations.reduce((s, a) => s + a.interestCharged, 0) * 100) / 100,
      allocations,
    });

    if (month === MAX_MONTHS && [...balances.values()].some((b) => b > 0)) {
      truncated = true;
    }
  }

  const debtSummaries: DebtPayoffSummary[] = input.debts.map((d) => ({
    debtId: d.id,
    name: d.name,
    originalBalance: d.balance,
    totalInterestPaid: Math.round((interestAccum.get(d.id) ?? 0) * 100) / 100,
    payoffMonth: payoffMonth.get(d.id) ?? (truncated ? MAX_MONTHS + 1 : 0),
  }));

  return {
    strategy,
    totalMonths: months.length,
    totalInterestPaid: Math.round(totalInterestPaid * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    debtSummaries,
    months,
    truncated,
  };
}
