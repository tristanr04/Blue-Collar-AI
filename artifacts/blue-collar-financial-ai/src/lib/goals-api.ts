/**
 * Goals API client — wraps all /api/goals endpoints.
 */

const API_BASE = "/api";

export interface Goal {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  category:
    | "emergency_fund"
    | "savings"
    | "debt_payoff"
    | "investment"
    | "purchase"
    | "other";
  targetAmount: number;
  currentAmount: number;
  targetDate?: string | null;
  status: "active" | "completed" | "paused" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface CreateGoalInput {
  title: string;
  description?: string;
  category?: Goal["category"];
  targetAmount: number;
  currentAmount?: number;
  targetDate?: string;
  status?: "active" | "paused";
}

export type UpdateGoalInput = Partial<CreateGoalInput>;

async function gFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
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
    throw new Error(body?.error ?? `Goals API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function listGoals(token: string): Promise<Goal[]> {
  const data = await gFetch<{ goals: Goal[] }>("/goals", token);
  return data.goals;
}

export async function getEmergencyFundGoal(
  token: string,
  suggestedTarget?: number,
): Promise<Goal> {
  const qs = suggestedTarget ? `?suggestedTarget=${suggestedTarget}` : "";
  const data = await gFetch<{ goal: Goal }>(`/goals/emergency-fund${qs}`, token);
  return data.goal;
}

export async function createGoal(token: string, input: CreateGoalInput): Promise<Goal> {
  const data = await gFetch<{ goal: Goal }>("/goals", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.goal;
}

export async function updateGoal(
  token: string,
  id: string,
  input: UpdateGoalInput,
): Promise<Goal> {
  const data = await gFetch<{ goal: Goal }>(`/goals/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return data.goal;
}

export async function contributeToGoal(
  token: string,
  id: string,
  amount: number,
): Promise<Goal> {
  const data = await gFetch<{ goal: Goal }>(`/goals/${id}/contribute`, token, {
    method: "POST",
    body: JSON.stringify({ amount }),
  });
  return data.goal;
}

export async function archiveGoal(token: string, id: string): Promise<void> {
  await gFetch(`/goals/${id}`, token, { method: "DELETE" });
}
