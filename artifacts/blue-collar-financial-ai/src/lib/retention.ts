export type MonthlyCheckInKey =
  | 'scan'
  | 'reviewBills'
  | 'reviewDebt'
  | 'reviewInvestments';

export type MonthlyCheckInState = Record<MonthlyCheckInKey, boolean>;

export interface RetentionState {
  currentMonth: string;
  completed: MonthlyCheckInState;
  streakMonths: number;
  lastCompletedMonth?: string;
  dismissedPrompts: string[];
}

const STORAGE_KEY = 'bcfai-retention-v1';

const emptyChecklist = (): MonthlyCheckInState => ({
  scan: false,
  reviewBills: false,
  reviewDebt: false,
  reviewInvestments: false,
});

export const monthKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const previousMonthKey = (date = new Date()) => {
  const previous = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return monthKey(previous);
};

export const defaultRetentionState = (): RetentionState => ({
  currentMonth: monthKey(),
  completed: emptyChecklist(),
  streakMonths: 0,
  dismissedPrompts: [],
});

export function loadRetentionState(): RetentionState {
  if (typeof window === 'undefined') return defaultRetentionState();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultRetentionState();

    const parsed = JSON.parse(raw) as RetentionState;
    const current = monthKey();

    if (parsed.currentMonth === current) {
      return {
        ...defaultRetentionState(),
        ...parsed,
        completed: { ...emptyChecklist(), ...parsed.completed },
      };
    }

    const lastMonthWasComplete = Object.values(parsed.completed || {}).every(Boolean);
    const keptStreak =
      parsed.currentMonth === previousMonthKey() && lastMonthWasComplete
        ? parsed.streakMonths + 1
        : 0;

    const next: RetentionState = {
      currentMonth: current,
      completed: emptyChecklist(),
      streakMonths: keptStreak,
      lastCompletedMonth: lastMonthWasComplete
        ? parsed.currentMonth
        : parsed.lastCompletedMonth,
      dismissedPrompts: parsed.dismissedPrompts || [],
    };

    saveRetentionState(next);
    return next;
  } catch {
    return defaultRetentionState();
  }
}

export function saveRetentionState(state: RetentionState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function setCheckInItem(
  state: RetentionState,
  key: MonthlyCheckInKey,
  value: boolean,
): RetentionState {
  const next = {
    ...state,
    completed: { ...state.completed, [key]: value },
  };

  saveRetentionState(next);
  return next;
}

export function dismissRetentionPrompt(
  state: RetentionState,
  promptId: string,
): RetentionState {
  if (state.dismissedPrompts.includes(promptId)) return state;

  const next = {
    ...state,
    dismissedPrompts: [...state.dismissedPrompts, promptId],
  };
  saveRetentionState(next);
  return next;
}

export function getCheckInProgress(state: RetentionState) {
  const values = Object.values(state.completed);
  const completed = values.filter(Boolean).length;
  return {
    completed,
    total: values.length,
    percent: Math.round((completed / values.length) * 100),
    isComplete: completed === values.length,
  };
}
