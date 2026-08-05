import { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Compass, Flag, Sparkles, Target, TrendingUp } from 'lucide-react';
import { useStore } from '@/lib/store';

type ProgressZone = 'ahead' | 'on-path' | 'building';

type Benchmark = {
  age: number;
  emergencyMonths: number;
  retirementIncomeMultiple: number;
  highInterestDebtTarget: number;
};

// Planning targets, not claims about what every person of an age owns.
// Keep this table versioned and replace it with server-managed benchmark sets later.
const PLANNING_TARGETS: Benchmark[] = [
  { age: 20, emergencyMonths: 1, retirementIncomeMultiple: 0.05, highInterestDebtTarget: 0 },
  { age: 25, emergencyMonths: 2, retirementIncomeMultiple: 0.25, highInterestDebtTarget: 0 },
  { age: 30, emergencyMonths: 3, retirementIncomeMultiple: 0.75, highInterestDebtTarget: 0 },
  { age: 35, emergencyMonths: 4, retirementIncomeMultiple: 1.5, highInterestDebtTarget: 0 },
  { age: 40, emergencyMonths: 5, retirementIncomeMultiple: 2.5, highInterestDebtTarget: 0 },
  { age: 45, emergencyMonths: 6, retirementIncomeMultiple: 3.5, highInterestDebtTarget: 0 },
  { age: 50, emergencyMonths: 6, retirementIncomeMultiple: 5, highInterestDebtTarget: 0 },
  { age: 55, emergencyMonths: 6, retirementIncomeMultiple: 6.5, highInterestDebtTarget: 0 },
  { age: 60, emergencyMonths: 6, retirementIncomeMultiple: 8, highInterestDebtTarget: 0 },
  { age: 65, emergencyMonths: 6, retirementIncomeMultiple: 10, highInterestDebtTarget: 0 },
];

function targetForAge(age: number): Benchmark {
  const sorted = [...PLANNING_TARGETS].sort((a, b) => a.age - b.age);
  const upper = sorted.find(item => item.age >= age) ?? sorted[sorted.length - 1];
  const lower = [...sorted].reverse().find(item => item.age <= age) ?? sorted[0];
  if (upper.age === lower.age) return upper;
  const weight = (age - lower.age) / (upper.age - lower.age);
  return {
    age,
    emergencyMonths: lower.emergencyMonths + (upper.emergencyMonths - lower.emergencyMonths) * weight,
    retirementIncomeMultiple: lower.retirementIncomeMultiple + (upper.retirementIncomeMultiple - lower.retirementIncomeMultiple) * weight,
    highInterestDebtTarget: 0,
  };
}

function zoneForRatio(ratio: number): ProgressZone {
  if (ratio >= 1.15) return 'ahead';
  if (ratio >= 0.8) return 'on-path';
  return 'building';
}

function zoneCopy(zone: ProgressZone) {
  if (zone === 'ahead') return {
    title: 'You have strong momentum',
    body: 'You are currently above this planning target. Protect the progress and consider directing the next raise, storm check, or paid-off payment toward the next goal.',
    icon: Sparkles,
  };
  if (zone === 'on-path') return {
    title: 'You are moving on a solid path',
    body: 'You are within reach of this planning target. A consistent small increase can strengthen the path without forcing a major lifestyle change.',
    icon: CheckCircle2,
  };
  return {
    title: 'Here is your clearest route forward',
    body: 'This is a starting point, not a grade. Focus on the next controllable move below and the app will update your route as your numbers improve.',
    icon: Compass,
  };
}

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

export default function AgeProgress() {
  const { computed, debts } = useStore();
  const [age, setAge] = useState(() => Number(localStorage.getItem('bcf_age') || 30));
  const [monthlyContribution, setMonthlyContribution] = useState(500);

  const annualGross = computed.monthlyGross * 12;
  const target = useMemo(() => targetForAge(age), [age]);
  const retirementTarget = annualGross * target.retirementIncomeMultiple;
  const retirementRatio = retirementTarget > 0 ? computed.retirementTotal / retirementTarget : 0;
  const emergencyRatio = target.emergencyMonths > 0 ? computed.emergencyMonths / target.emergencyMonths : 0;
  const highInterestDebt = debts.filter(debt => debt.interestRate >= 10).reduce((sum, debt) => sum + debt.balance, 0);
  const debtRatio = highInterestDebt <= 0 ? 1.2 : Math.max(0, 1 - highInterestDebt / Math.max(annualGross, 1));
  const overallRatio = retirementRatio * 0.5 + emergencyRatio * 0.3 + debtRatio * 0.2;
  const zone = zoneForRatio(overallRatio);
  const copy = zoneCopy(zone);
  const ZoneIcon = copy.icon;

  const retirementGap = Math.max(0, retirementTarget - computed.retirementTotal);
  const emergencyMonthlyExpenses = computed.totalBills + computed.totalDebtMin;
  const emergencyTarget = emergencyMonthlyExpenses * target.emergencyMonths;
  const emergencyGap = Math.max(0, emergencyTarget - computed.liquidCash);
  const monthsToRetirementTarget = monthlyContribution > 0 ? Math.ceil(retirementGap / monthlyContribution) : 0;

  const saveAge = (nextAge: number) => {
    const safeAge = Math.min(80, Math.max(18, nextAge || 18));
    setAge(safeAge);
    localStorage.setItem('bcf_age', String(safeAge));
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 pb-24 md:p-8">
      <section className="rounded-3xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-slate-950 to-cyan-500/5 p-6 md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-cyan-400">
              <Target className="h-4 w-4" /> Age Progress Path
            </div>
            <h1 className="text-3xl font-black text-white md:text-4xl">See your momentum without the discouragement.</h1>
            <p className="mt-3 text-slate-400">This compares your current numbers with adjustable planning targets and turns every gap into a specific next move. It never labels you as behind.</p>
          </div>
          <label className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">Your age</span>
            <input
              type="number"
              min={18}
              max={80}
              value={age}
              onChange={event => saveAge(Number(event.target.value))}
              className="w-28 bg-transparent text-3xl font-black text-white outline-none"
            />
          </label>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-400"><ZoneIcon className="h-6 w-6" /></div>
          <div>
            <h2 className="text-xl font-black text-white">{copy.title}</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{copy.body}</p>
          </div>
        </div>
        <div className="mt-6 h-3 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" style={{ width: `${Math.min(100, Math.max(8, overallRatio * 100))}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-xs font-semibold text-slate-500"><span>Building</span><span>On path</span><span>Strong momentum</span></div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="Retirement path" current={money(computed.retirementTotal)} target={money(retirementTarget)} ratio={retirementRatio} />
        <MetricCard title="Emergency cushion" current={`${computed.emergencyMonths.toFixed(1)} months`} target={`${target.emergencyMonths.toFixed(1)} months`} ratio={emergencyRatio} />
        <MetricCard title="High-interest debt" current={money(highInterestDebt)} target="Route toward $0" ratio={debtRatio} inverse />
      </div>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
          <div className="flex items-center gap-2 text-lg font-black text-white"><Flag className="h-5 w-5 text-blue-400" /> Your next best moves</div>
          <div className="mt-5 space-y-3">
            {highInterestDebt > 0 && <Action text={`Direct extra cash toward ${money(highInterestDebt)} of debt above 10% before increasing lower-priority investing.`} />}
            {emergencyGap > 0 && <Action text={`Build another ${money(emergencyGap)} to reach the current emergency-cushion target.`} />}
            {retirementGap > 0 && <Action text={`At ${money(monthlyContribution)} per month, you would contribute the current retirement gap in about ${monthsToRetirementTarget} months before investment growth.`} />}
            {highInterestDebt <= 0 && emergencyGap <= 0 && retirementGap <= 0 && <Action text="Your current planning targets are covered. Consider raising the target or building toward your next major purchase without new high-interest debt." />}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
          <div className="flex items-center gap-2 text-lg font-black text-white"><TrendingUp className="h-5 w-5 text-cyan-400" /> Test a monthly move</div>
          <p className="mt-2 text-sm text-slate-400">Change the amount to see a simple contribution timeline. Investment returns are intentionally excluded here so the route stays conservative.</p>
          <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Monthly amount</label>
            <div className="mt-2 flex items-center gap-3">
              <span className="text-2xl font-black text-slate-500">$</span>
              <input type="number" min={0} value={monthlyContribution} onChange={event => setMonthlyContribution(Math.max(0, Number(event.target.value)))} className="w-full bg-transparent text-3xl font-black text-white outline-none" />
            </div>
          </div>
          <p className="mt-4 text-sm font-semibold text-cyan-300">Estimated contribution timeline: {monthsToRetirementTarget || 0} months</p>
        </div>
      </section>

      <p className="rounded-2xl border border-amber-400/15 bg-amber-400/5 p-4 text-xs leading-5 text-amber-200/80">
        Planning targets are directional, not a judgment or a guarantee. Results depend on income stability, pension benefits, cost of living, family responsibilities, market returns, and the completeness of scanned data.
      </p>
    </div>
  );
}

function MetricCard({ title, current, target, ratio, inverse = false }: { title: string; current: string; target: string; ratio: number; inverse?: boolean }) {
  const zone = zoneForRatio(ratio);
  const label = zone === 'ahead' ? 'Strong momentum' : zone === 'on-path' ? 'Within reach' : 'Next opportunity';
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</p>
      <p className="mt-3 text-2xl font-black text-white">{current}</p>
      <div className="mt-4 flex items-center justify-between text-xs"><span className="text-slate-500">Planning target</span><span className="font-bold text-slate-300">{target}</span></div>
      <div className="mt-3 flex items-center gap-2 text-sm font-bold text-cyan-400"><ArrowRight className="h-4 w-4" /> {inverse && ratio < 1 ? 'Reduce the balance step by step' : label}</div>
    </div>
  );
}

function Action({ text }: { text: string }) {
  return <div className="flex gap-3 rounded-2xl border border-white/10 bg-slate-950/45 p-4 text-sm leading-6 text-slate-300"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />{text}</div>;
}
