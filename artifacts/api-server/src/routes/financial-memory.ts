import { Router, type IRouter } from "express";

const router: IRouter = Router();

type MemoryRecord = {
  id: string;
  type: "goal" | "commitment" | "life_event" | "preference" | "milestone";
  title: string;
  detail?: string;
  status?: "active" | "completed" | "paused" | "dismissed";
  createdAt: string;
  targetDate?: string | null;
  completedAt?: string | null;
  currentValue?: number | null;
  targetValue?: number | null;
  unit?: "usd" | "percent" | "count" | "days" | "none";
  source?: "user" | "scanner" | "tax" | "spending" | "insurance" | "system";
};

type MomentumPoint = {
  date: string;
  netWorth?: number;
  cash?: number;
  debt?: number;
  investments?: number;
  retirement?: number;
  spending?: number;
  healthScore?: number;
};

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function progress(record: MemoryRecord): number | null {
  const current = safeNumber(record.currentValue);
  const target = safeNumber(record.targetValue);
  if (current === null || target === null || target <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((current / target) * 100)));
}

function buildFollowUp(record: MemoryRecord): string {
  const pct = progress(record);
  if (record.status === "completed") return `${record.title} is complete. Keep the momentum going.`;
  if (pct !== null && pct >= 90) return `${record.title} is ${pct}% complete. You are in the final stretch.`;
  if (pct !== null && pct >= 50) return `${record.title} is ${pct}% complete. Your current path is working.`;
  if (pct !== null) return `${record.title} is ${pct}% complete. The next small step will keep it moving.`;
  if (record.targetDate && validDate(record.targetDate)) {
    const days = Math.ceil((new Date(record.targetDate).getTime() - Date.now()) / 86_400_000);
    if (days >= 0) return `${record.title} has ${days} day${days === 1 ? "" : "s"} remaining.`;
  }
  return `Keep ${record.title.toLowerCase()} visible as an active priority.`;
}

router.post("/command-center/memory", (req, res) => {
  const records = Array.isArray(req.body?.records) ? req.body.records as MemoryRecord[] : [];
  const normalized = records
    .filter(record => record && typeof record.id === "string" && typeof record.title === "string" && validDate(record.createdAt))
    .map(record => ({
      ...record,
      status: record.status ?? "active",
      progressPercent: progress(record),
      followUp: buildFollowUp(record),
    }))
    .sort((a, b) => {
      if (a.status === "active" && b.status !== "active") return -1;
      if (b.status === "active" && a.status !== "active") return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  res.json({
    generatedAt: new Date().toISOString(),
    active: normalized.filter(item => item.status === "active").slice(0, 8),
    completed: normalized.filter(item => item.status === "completed").slice(0, 8),
    milestones: normalized.filter(item => item.type === "milestone").slice(0, 8),
    nextFollowUp: normalized.find(item => item.status === "active") ?? null,
  });
});

router.post("/command-center/momentum", (req, res) => {
  const raw = Array.isArray(req.body?.points) ? req.body.points as MomentumPoint[] : [];
  const points = raw
    .filter(point => point && validDate(point.date))
    .map(point => ({
      date: new Date(point.date).toISOString().slice(0, 10),
      netWorth: safeNumber(point.netWorth),
      cash: safeNumber(point.cash),
      debt: safeNumber(point.debt),
      investments: safeNumber(point.investments),
      retirement: safeNumber(point.retirement),
      spending: safeNumber(point.spending),
      healthScore: safeNumber(point.healthScore),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const first = points[0] ?? null;
  const latest = points.at(-1) ?? null;
  const delta = (key: keyof MomentumPoint) => {
    const start = first ? safeNumber(first[key]) : null;
    const end = latest ? safeNumber(latest[key]) : null;
    return start === null || end === null ? null : Number((end - start).toFixed(2));
  };

  const wins: string[] = [];
  const netWorthChange = delta("netWorth");
  const debtChange = delta("debt");
  const retirementChange = delta("retirement");
  const cashChange = delta("cash");
  if (netWorthChange !== null && netWorthChange > 0) wins.push(`Net worth increased by $${Math.round(netWorthChange)}.`);
  if (debtChange !== null && debtChange < 0) wins.push(`Debt decreased by $${Math.round(Math.abs(debtChange))}.`);
  if (retirementChange !== null && retirementChange > 0) wins.push(`Retirement savings increased by $${Math.round(retirementChange)}.`);
  if (cashChange !== null && cashChange > 0) wins.push(`Cash reserves increased by $${Math.round(cashChange)}.`);

  res.json({
    generatedAt: new Date().toISOString(),
    points,
    change: {
      netWorth: netWorthChange,
      cash: cashChange,
      debt: debtChange,
      investments: delta("investments"),
      retirement: retirementChange,
      spending: delta("spending"),
      healthScore: delta("healthScore"),
    },
    wins: wins.slice(0, 5),
    trendDirection: netWorthChange === null ? "insufficient_data" : netWorthChange > 0 ? "improving" : netWorthChange < 0 ? "needs_attention" : "steady",
    dataQuality: {
      complete: points.length >= 2,
      pointCount: points.length,
      warning: points.length < 2 ? "At least two dated snapshots are needed to calculate momentum." : null,
    },
  });
});

export default router;
