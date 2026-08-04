import React, { useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  ArrowRight, Banknote, Bell, Bot, BriefcaseBusiness, CalendarClock,
  CircleDollarSign, CreditCard, FileScan, Gauge, Home, Landmark,
  PiggyBank, ShieldCheck, Sparkles, TrendingUp, WalletCards,
} from 'lucide-react';
import { useStore } from '@/lib/store';

const money = (value: number) => {
  const abs = Math.abs(value || 0);
  const formatted = abs.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return value < 0 ? `-$${formatted}` : `$${formatted}`;
};

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
  detail,
  onClick,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'blue' | 'green' | 'purple' | 'red';
  detail?: string;
  onClick?: () => void;
}) {
  const tones = {
    blue: 'border-blue-500/20 bg-blue-500/10 text-blue-300',
    green: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
    purple: 'border-violet-500/20 bg-violet-500/10 text-violet-300',
    red: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-white/8 bg-white/[0.035] p-4 text-left transition hover:border-blue-400/30 hover:bg-white/[0.06]"
    >
      <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl border ${tones[tone]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-xs font-medium uppercase tracking-[0.13em] text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-white">{value}</div>
      {detail && <div className="mt-1 text-xs text-slate-500">{detail}</div>}
    </button>
  );
}

function QuickAction({
  label,
  detail,
  icon: Icon,
  onClick,
  primary,
}: {
  label: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={primary
        ? 'group flex min-h-24 flex-col justify-between rounded-2xl border border-blue-400/40 bg-blue-600 p-4 text-left shadow-[0_14px_40px_rgba(37,99,235,0.24)] transition hover:bg-blue-500'
        : 'group flex min-h-24 flex-col justify-between rounded-2xl border border-white/8 bg-white/[0.035] p-4 text-left transition hover:border-blue-400/30 hover:bg-white/[0.06]'}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={primary
          ? 'inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-white'
          : 'inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-blue-300'}>
          <Icon className="h-5 w-5" />
        </span>
        <ArrowRight className="h-4 w-4 text-white/50 transition group-hover:translate-x-1" />
      </div>
      <div>
        <div className="font-semibold text-white">{label}</div>
        <div className={primary ? 'mt-0.5 text-xs text-blue-100' : 'mt-0.5 text-xs text-slate-500'}>{detail}</div>
      </div>
    </button>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { profile, paystubs, bills, debts, assets } = useStore();

  useEffect(() => {
    if (!profile?.hasCompletedOnboarding) setLocation('/welcome');
  }, [profile, setLocation]);

  if (!profile) return null;

  const latestPaystub = paystubs[0];
  const multiplier = profile.payFrequency === 'Weekly'
    ? 4.33
    : profile.payFrequency === 'Bi-Weekly'
      ? 2.17
      : profile.payFrequency === 'Semi-Monthly'
        ? 2
        : 1;

  const monthlyIncome = (latestPaystub?.netPay ?? 0) * multiplier;
  const monthlyBills = bills.reduce((sum, bill) => sum + (bill.amount || 0), 0);
  const monthlyDebtPayments = debts.reduce((sum, debt) => sum + (debt.minimumPayment || 0), 0);
  const freeCash = monthlyIncome - monthlyBills - monthlyDebtPayments;
  const totalDebt = debts.reduce((sum, debt) => sum + (debt.balance || 0), 0);
  const cash = assets.filter(asset => asset.type === 'Cash').reduce((sum, asset) => sum + (asset.value || 0), 0);
  const investments = assets.filter(asset => asset.type === 'Investment').reduce((sum, asset) => sum + (asset.value || 0), 0);
  const homeEquity = assets
    .filter(asset => /home|house|property|real estate/i.test(asset.name || ''))
    .reduce((sum, asset) => sum + (asset.value || 0), 0);
  const netWorth = assets.reduce((sum, asset) => sum + (asset.value || 0), 0) - totalDebt;
  const emergencyMonths = monthlyBills + monthlyDebtPayments > 0
    ? cash / (monthlyBills + monthlyDebtPayments)
    : 0;

  const scoreParts = [
    monthlyIncome > 0 ? 20 : 0,
    freeCash > 0 ? Math.min(20, Math.round((freeCash / Math.max(monthlyIncome, 1)) * 100)) : 0,
    emergencyMonths >= 6 ? 20 : emergencyMonths >= 3 ? 14 : emergencyMonths >= 1 ? 7 : 0,
    investments > 0 ? 20 : 0,
    totalDebt === 0 ? 20 : totalDebt < monthlyIncome * 12 ? 14 : 7,
  ];
  const healthScore = scoreParts.reduce((sum, value) => sum + value, 0);
  const progress = Math.max(0, Math.min(100, Math.round((freeCash / Math.max(monthlyIncome, 1)) * 100)));

  const priorities = [
    bills[0] && {
      icon: CalendarClock,
      title: bills[0].name,
      detail: bills[0].dueDate ? `Due ${bills[0].dueDate}` : 'Upcoming bill',
      value: money(bills[0].amount || 0),
      color: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
    },
    debts[0] && {
      icon: CreditCard,
      title: debts[0].name,
      detail: 'Minimum payment',
      value: money(debts[0].minimumPayment || 0),
      color: 'text-rose-300 bg-rose-500/10 border-rose-500/20',
    },
    investments > 0 && {
      icon: TrendingUp,
      title: 'Investment progress',
      detail: `${assets.filter(asset => asset.type === 'Investment').length} linked accounts`,
      value: money(investments),
      color: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
    },
  ].filter(Boolean) as Array<{
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    detail: string;
    value: string;
    color: string;
  }>;

  return (
    <div className="min-h-full bg-[#050b15] text-white">
      <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-blue-400">
              <ShieldCheck className="h-4 w-4" /> Financial Command Center
            </div>
            <h1 className="text-2xl font-semibold md:text-3xl">Good afternoon, {profile.name}</h1>
            <p className="mt-1 text-sm text-slate-500">Here is the complete picture of your money today.</p>
          </div>
          <button
            type="button"
            onClick={() => setLocation('/bills')}
            aria-label="View bills"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/8 bg-white/[0.035] text-slate-300"
          >
            <Bell className="h-5 w-5" />
          </button>
        </header>

        <section className="overflow-hidden rounded-3xl border border-emerald-400/25 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.16),transparent_40%),linear-gradient(145deg,rgba(9,24,33,0.98),rgba(6,15,27,0.98))] p-5 md:p-7">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Total net worth</div>
              <div className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">{money(netWorth)}</div>
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                <TrendingUp className="h-3.5 w-3.5" /> Live from your confirmed accounts
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:min-w-80">
              <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                <div className="text-xs text-slate-500">Monthly income</div>
                <div className="mt-1 text-lg font-semibold">{money(monthlyIncome)}</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                <div className="text-xs text-slate-500">Free cash</div>
                <div className={freeCash >= 0 ? 'mt-1 text-lg font-semibold text-emerald-300' : 'mt-1 text-lg font-semibold text-rose-300'}>
                  {money(freeCash)}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label="Cash" value={money(cash)} icon={Banknote} tone="green" detail={`${emergencyMonths.toFixed(1)} months covered`} onClick={() => setLocation('/banking')} />
          <MetricCard label="Investments" value={money(investments)} icon={TrendingUp} tone="blue" detail="Brokerage + retirement" onClick={() => setLocation('/investments')} />
          <MetricCard label="Home equity" value={money(homeEquity)} icon={Home} tone="purple" detail="Tracked property value" />
          <MetricCard label="Debt" value={money(-totalDebt)} icon={CreditCard} tone="red" detail={`${debts.length} active accounts`} onClick={() => setLocation('/debts')} />
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="font-semibold">Quick actions</h2>
              <p className="text-xs text-slate-500">Keep your financial picture current.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <QuickAction primary label="Scan documents" detail="Update everything with AI" icon={FileScan} onClick={() => setLocation('/scanner')} />
            <QuickAction label="Ask Blue Collar AI" detail="Get a personalized answer" icon={Bot} onClick={() => setLocation('/ask-ai')} />
            <QuickAction label="Run a scenario" detail="Test your next move" icon={Gauge} onClick={() => setLocation('/scenario')} />
            <QuickAction label="View accounts" detail="Cash, debt and investing" icon={WalletCards} onClick={() => setLocation('/banking')} />
          </div>
        </section>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-white/8 bg-white/[0.035] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-semibold">Monthly cash flow</h2>
                <p className="text-xs text-slate-500">What remains after bills and minimum debt payments.</p>
              </div>
              <CircleDollarSign className="h-5 w-5 text-blue-300" />
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <div>
                <div className="text-xs text-slate-500">Income</div>
                <div className="mt-1 font-semibold text-emerald-300">{money(monthlyIncome)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Bills + debt</div>
                <div className="mt-1 font-semibold text-rose-300">{money(monthlyBills + monthlyDebtPayments)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Available</div>
                <div className="mt-1 font-semibold text-blue-300">{money(freeCash)}</div>
              </div>
            </div>

            <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-400" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-xs text-slate-500">
              <span>{progress}% of take-home remains</span>
              <span>{money(monthlyBills)} in bills</span>
            </div>
          </section>

          <section className="rounded-3xl border border-white/8 bg-white/[0.035] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-semibold">Financial health</h2>
                <p className="text-xs text-slate-500">Built from the information you confirmed.</p>
              </div>
              <Sparkles className="h-5 w-5 text-emerald-300" />
            </div>
            <div className="mt-5 flex items-center gap-5">
              <div className="relative h-28 w-28 shrink-0 rounded-full" style={{ background: `conic-gradient(#22c55e ${healthScore * 3.6}deg, #172033 0deg)` }}>
                <div className="absolute inset-3 flex flex-col items-center justify-center rounded-full bg-[#09111e]">
                  <div className="text-2xl font-semibold">{healthScore}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">out of 100</div>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-slate-300"><PiggyBank className="h-4 w-4 text-emerald-300" /> Emergency fund: {emergencyMonths.toFixed(1)} months</div>
                <div className="flex items-center gap-2 text-slate-300"><BriefcaseBusiness className="h-4 w-4 text-blue-300" /> Investments: {money(investments)}</div>
                <div className="flex items-center gap-2 text-slate-300"><Landmark className="h-4 w-4 text-violet-300" /> Net worth: {money(netWorth)}</div>
              </div>
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-3xl border border-white/8 bg-white/[0.035] p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Today&apos;s priorities</h2>
              <p className="text-xs text-slate-500">The next items that deserve your attention.</p>
            </div>
            <button type="button" onClick={() => setLocation('/bills')} className="text-xs font-medium text-blue-300">View all</button>
          </div>

          {priorities.length > 0 ? (
            <div className="divide-y divide-white/5">
              {priorities.map(({ icon: Icon, title, detail, value, color }) => (
                <div key={`${title}-${detail}`} className="flex items-center gap-3 py-3 first:pt-1 last:pb-0">
                  <div className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-100">{title}</div>
                    <div className="truncate text-xs text-slate-500">{detail}</div>
                  </div>
                  <div className="text-sm font-semibold text-slate-200">{value}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center">
              <p className="text-sm text-slate-400">Scan your documents to build today&apos;s priority list.</p>
              <button type="button" onClick={() => setLocation('/scanner')} className="mt-3 text-sm font-medium text-blue-300">Start a scan →</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
