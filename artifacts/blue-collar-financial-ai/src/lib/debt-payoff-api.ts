/**
 * Debt payoff API client — calculation and plan management.
 */

const API_BASE = "/api";

export type PayoffStrategy = "avalanche" | "snowball" | "utilization" | "custom";

export interface DebtPayoffPlan {
  id: string;
  userId: string;
  name: string;
  strategy: PayoffStrategy;
  extraMonthlyPayment: number;
  customOrder: string[];
  status: "active" | "completed" | "archived";
  createdAt: string;
  updatedAt: string;
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
  months: PayoffMonth[];
  truncated: boolean;
}

async function dpFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `Debt payoff API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function calculatePayoff(
  token: string,
  strategy: PayoffStrategy,
  extraMonthlyPayment = 0,
  customOrder?: string[],
): Promise<PayoffSchedule> {
  const data = await dpFetch<{ schedule: PayoffSchedule }>("/debt-payoff/calculate", token, {
    method: "POST",
    body: JSON.stringify({ strategy, extraMonthlyPayment, customOrder }),
  });
  return data.schedule;
}

export async function listPayoffPlans(token: string): Promise<DebtPayoffPlan[]> {
  const data = await dpFetch<{ plans: DebtPayoffPlan[] }>("/debt-payoff/plans", token);
  return data.plans;
}

export async function createPayoffPlan(
  token: string,
  input: {
    name: string;
    strategy: PayoffStrategy;
    extraMonthlyPayment?: number;
    customOrder?: string[];
  },
): Promise<DebtPayoffPlan> {
  const data = await dpFetch<{ plan: DebtPayoffPlan }>("/debt-payoff/plans", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.plan;
}

export async function getPayoffPlan(
  token: string,
  id: string,
): Promise<{ plan: DebtPayoffPlan; schedule: PayoffSchedule }> {
  return dpFetch(`/debt-payoff/plans/${id}`, token);
}

export async function updatePayoffPlan(
  token: string,
  id: string,
  input: Partial<{
    name: string;
    strategy: PayoffStrategy;
    extraMonthlyPayment: number;
    customOrder: string[];
  }>,
): Promise<{ plan: DebtPayoffPlan; schedule: PayoffSchedule }> {
  return dpFetch(`/debt-payoff/plans/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function archivePayoffPlan(token: string, id: string): Promise<void> {
  await dpFetch(`/debt-payoff/plans/${id}`, token, { method: "DELETE" });
}
