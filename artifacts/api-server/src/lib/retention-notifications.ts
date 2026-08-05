export type NotificationCategory =
  | "tax"
  | "insurance"
  | "spending"
  | "credit"
  | "savings"
  | "debt"
  | "goal"
  | "document"
  | "win";

export type NotificationCandidate = {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  actionLabel?: string;
  actionPath?: string;
  urgency: "low" | "medium" | "high" | "critical";
  estimatedDollarImpact?: number;
  eventAt?: string;
  dedupeKey: string;
  expiresAt?: string;
};

export type NotificationPreferences = {
  enabled?: boolean;
  categories?: Partial<Record<NotificationCategory, boolean>>;
  quietHours?: { startHour: number; endHour: number; timeZone?: string };
  maxPerDay?: number;
  minimumUrgency?: "low" | "medium" | "high" | "critical";
  allowWins?: boolean;
};

export type NotificationHistoryItem = {
  dedupeKey: string;
  sentAt: string;
  dismissedAt?: string;
  openedAt?: string;
};

const URGENCY_SCORE = { low: 10, medium: 40, high: 70, critical: 100 } as const;
const MINIMUM_SCORE = { low: 10, medium: 40, high: 70, critical: 100 } as const;

function isQuietHour(now: Date, quiet?: NotificationPreferences["quietHours"]): boolean {
  if (!quiet) return false;
  const hour = now.getUTCHours();
  const start = Math.max(0, Math.min(23, quiet.startHour));
  const end = Math.max(0, Math.min(23, quiet.endHour));
  return start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function recentHistory(history: NotificationHistoryItem[], now: Date, hours: number): NotificationHistoryItem[] {
  const cutoff = now.getTime() - hours * 60 * 60 * 1000;
  return history.filter(item => new Date(item.sentAt).getTime() >= cutoff);
}

function cooldownHours(candidate: NotificationCandidate): number {
  if (candidate.urgency === "critical") return 6;
  if (candidate.urgency === "high") return 24;
  if (candidate.category === "win") return 168;
  return 72;
}

function score(candidate: NotificationCandidate, now: Date): number {
  let value = URGENCY_SCORE[candidate.urgency];
  const impact = Math.max(0, candidate.estimatedDollarImpact ?? 0);
  value += Math.min(30, Math.log10(impact + 1) * 10);
  if (candidate.eventAt) {
    const days = (new Date(candidate.eventAt).getTime() - now.getTime()) / 86_400_000;
    if (days <= 1) value += 25;
    else if (days <= 7) value += 15;
    else if (days <= 30) value += 5;
  }
  return Math.round(value);
}

export function selectRetentionNotifications(args: {
  candidates: NotificationCandidate[];
  history?: NotificationHistoryItem[];
  preferences?: NotificationPreferences;
  now?: Date;
}): { selected: Array<NotificationCandidate & { score: number }>; suppressed: Array<{ id: string; reason: string }> } {
  const now = args.now ?? new Date();
  const preferences = args.preferences ?? {};
  const history = args.history ?? [];
  const selected: Array<NotificationCandidate & { score: number }> = [];
  const suppressed: Array<{ id: string; reason: string }> = [];

  if (preferences.enabled === false) {
    return { selected, suppressed: args.candidates.map(item => ({ id: item.id, reason: "notifications_disabled" })) };
  }

  const todayCount = recentHistory(history, now, 24).length;
  const maxPerDay = Math.max(1, Math.min(5, preferences.maxPerDay ?? 2));
  const remaining = Math.max(0, maxPerDay - todayCount);
  const minimum = MINIMUM_SCORE[preferences.minimumUrgency ?? "medium"];
  const quiet = isQuietHour(now, preferences.quietHours);

  for (const candidate of args.candidates) {
    if (candidate.expiresAt && new Date(candidate.expiresAt).getTime() <= now.getTime()) {
      suppressed.push({ id: candidate.id, reason: "expired" });
      continue;
    }
    if (preferences.categories?.[candidate.category] === false) {
      suppressed.push({ id: candidate.id, reason: "category_disabled" });
      continue;
    }
    if (candidate.category === "win" && preferences.allowWins === false) {
      suppressed.push({ id: candidate.id, reason: "wins_disabled" });
      continue;
    }
    const cooldown = cooldownHours(candidate);
    if (recentHistory(history.filter(item => item.dedupeKey === candidate.dedupeKey), now, cooldown).length) {
      suppressed.push({ id: candidate.id, reason: "cooldown" });
      continue;
    }
    if (quiet && candidate.urgency !== "critical") {
      suppressed.push({ id: candidate.id, reason: "quiet_hours" });
      continue;
    }
    const candidateScore = score(candidate, now);
    if (candidateScore < minimum) {
      suppressed.push({ id: candidate.id, reason: "below_threshold" });
      continue;
    }
    selected.push({ ...candidate, score: candidateScore });
  }

  selected.sort((a, b) => b.score - a.score);
  const overflow = selected.splice(remaining);
  suppressed.push(...overflow.map(item => ({ id: item.id, reason: "daily_limit" })));
  return { selected, suppressed };
}
