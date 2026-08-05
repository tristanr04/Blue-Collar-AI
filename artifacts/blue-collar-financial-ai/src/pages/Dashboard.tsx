import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/react';
import { useLocation } from 'wouter';
import {
  AlertCircle, ArrowRight, Banknote, Bot, ChevronRight,
  CircleDollarSign, CreditCard, FileScan, Gauge,
  PiggyBank, RefreshCw, ShieldCheck, Sparkles, TrendingDown,
  TrendingUp, WalletCards,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { getCommandCenterSummary, type CommandCenterSummaryResponse } from '@/lib/api';
import {
  resolveMetric, resolvePercentMetric, resolveEmergencyFund,
  resolveCashFlow, resolveTaxEstimate, resolveNextBestMove, resolveHealthScore,
  type MetricDisplay,
} from '@/lib/dashboard-utils';

// ─── Sub-components ────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  const bar = (cls: string) => (
    <div className={`animate-pulse rounded-xl bg-white/[0.06] ${cls}`} />
  );
  return (
    <div className="min-h-full bg-[#050b15] px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-8">
      <div className="mx-auto max-w-2xl space-y-4">
        {bar('h-8 w-48')}
        {bar('h-36 w-full rounded-3xl')}
        {bar('h-24 w-full rounded-3xl')}
        <div className="grid grid-cols-2 gap-3">
          {bar('h-24 rounded-2xl')}
          {bar('h-24 rounded-2xl')}
          {bar('h-24 rounded-2xl')}
          {bar('h-24 rounded-2xl')}
        </div>
      </div>
    </div>
  );
}

function ApiErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-4 mt-4 flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-rose-300">Could not load your summary</div>
        <div className="mt-0.5 text-sm text-rose-400/80">{message}</div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        aria-label="Retry"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
      >
        <RefreshCw className="h-4 w-4" />
      </button>
    </div>
  );
}

function EmptyCell({ prompt, onClick }: { prompt: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left text-xs text-blue-400 underline-offset-2 hover:underline"
    >
      {prompt}
    </button>
  );
}

function MetricCard({
  label,
  display,
  icon: Icon,
  tone,
  detail,
  onClick,
}: {
  label: string;
  display: MetricDisplay;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'blue' | 'green' | 'purple' | 'red' | 'amber';
  detail?: string;
  onClick?: () => void;
}) {
  const tones: Record<typeof tone, string> = {
    blue:   'border-blue-500/20 bg-blue-500/10 text-blue-300',
    green:  'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
    purple: 'border-violet-500/20 bg-violet-500/10 text-violet-300',
    red:    'border-rose-500/20 bg-rose-500/10 text-rose-300',
    amber:  'border-amber-500/20 bg-amber-500/10 text-amber-300',
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
      {display.kind === 'value' ? (
        <div className="mt-1 truncate text-xl font-semibold text-white">{display.display}</div>
      ) : (
        <div className="mt-1">
          <EmptyCell prompt={display.prompt} onClick={onClick} />
        </div>
      )}
      {detail && display.kind === 'value' && (
        <div className="mt-1 text-xs text-slate-500">{detail}</div>
      )}
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

// ─── Category icons for next best move ────────────────────────────────────────

const MOVE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  income:            TrendingUp,
  'cash-flow':       CircleDollarSign,
  'emergency-fund':  PiggyBank,
  debt:              CreditCard,
  credit:            WalletCards,
  retirement:        Sparkles,
  tax:               Gauge,
  'complete-profile': ShieldCheck,
};

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { profile } = useStore();
  const { getToken, isLoaded } = useAuth();

  const [summary, setSummary] = useState<CommandCenterSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.hasCompletedOnboarding) setLocation('/welcome');
  }, [profile, setLocation]);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Session expired. Please sign in again.');
      const data = await getCommandCenterSummary(token);
      setSummary(data);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Your financial summary could not be loaded right now.');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (isLoaded && profile) void fetchSummary();
  }, [isLoaded, profile, fetchSummary]);

  if (!profile) return null;
  if (!isLoaded || loading) return <LoadingSkeleton />;

  const nav = (path: string) => () => setLocation(path);

  // ── Resolve display values from server (no client-side recalculation) ──────
  const health     = resolveHealthScore(summary?.healthScore ?? null);
  const netWorth   = resolveMetric(summary?.netWorth,           'Upload a bank statement and add debts');
  const cashFlow   = resolveCashFlow(summary?.monthlyCashFlow);
  const taxDisplay = resolveTaxEstimate(summary?.taxEstimate);
  const move       = summary ? resolveNextBestMove(summary.nextBestMove) : null;

  const cashMetric        = resolveMetric(summary?.cash,              'Upload a bank statement');
  const investMetric      = resolveMetric(summary?.investments,       'Add investment accounts');
  const retirementMetric  = resolveMetric(summary?.retirement,        'Add a retirement account');
  const debtMetric        = resolveMetric(summary?.debt,              'Add a debt');
  const utilizationMetric = resolvePercentMetric(summary?.creditUtilization, 'Add a credit card');
  const emergencyMetric   = resolveEmergencyFund(summary?.emergencyFundMonths);

  const incomeMetric      = resolveMetric(summary?.monthlyIncome,       'Upload a recent paystub');
  const billsMetric       = resolveMetric(summary?.monthlyBills,        'Add monthly bills');
  const debtPayMetric     = resolveMetric(summary?.monthlyDebtPayments, 'Add a debt');

  const MoveIcon = move ? (MOVE_ICONS[move.category] ?? ShieldCheck) : ShieldCheck;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="min-h-full bg-[#050b15] text-white">
      <div className="mx-auto max-w-2xl px-4 pb-28 pt-5 md:px-6 md:pb-10 md:pt-8">

        {/* ── Header ── */}
        <header className="mb-5">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-blue-400">
            <ShieldCheck className="h-4 w-4" /> Financial Command Center
          </div>
          <h1 className="text-2xl font-semibold">{greeting}, {profile.name}</h1>
        </header>

        {/* ── API error banner ── */}
        {apiError && <ApiErrorBanner message={apiError} onRetry={fetchSummary} />}

        {/* ═══════════════════════════════════════════════════════════════════
            TOP SECTION (spec order):
            1. Health score  2. Net worth  3. Surplus/deficit
            4. Tax estimate  5. Next best move
        ═══════════════════════════════════════════════════════════════════ */}

        {/* 1 + 2 + 3: Hero card ── */}
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#0a1829] to-[#060f1b] p-5">
          <div className="flex items-center gap-4">
            {/* Health score ring */}
            {health ? (
              <div
                className="relative h-20 w-20 shrink-0 rounded-full"
                style={{ background: `conic-gradient(${health.ringColor} ${health.score * 3.6}deg, #172033 0deg)` }}
                aria-label={`Financial health score: ${health.score} out of 100`}
              >
                <div className="absolute inset-2 flex flex-col items-center justify-center rounded-full bg-[#060f1b]">
                  <div className="text-lg font-bold">{health.score}</div>
                  <div className={`text-[9px] font-medium uppercase tracking-wide ${health.color}`}>{health.label}</div>
                </div>
              </div>
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-dashed border-white/15 text-center">
                <span className="px-1 text-[10px] leading-tight text-slate-500">Add data for score</span>
              </div>
            )}

            <div className="min-w-0 flex-1">
              {/* Net worth */}
              <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Net worth</div>
              {netWorth.kind === 'value' ? (
                <div className="mt-0.5 text-3xl font-semibold tracking-tight">{netWorth.display}</div>
              ) : (
                <div className="mt-1">
                  <EmptyCell prompt={netWorth.prompt} onClick={nav('/scanner')} />
                </div>
              )}

              {/* Monthly surplus / deficit */}
              <div className="mt-2">
                {cashFlow ? (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    cashFlow.isNegative
                      ? 'border border-rose-500/25 bg-rose-500/10 text-rose-300'
                      : 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                  }`}>
                    {cashFlow.isNegative ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                    {cashFlow.display} / month
                  </span>
                ) : (
                  <EmptyCell prompt="Upload a paystub to see cash flow" onClick={nav('/scanner')} />
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 4: Tax estimate ── */}
        <section className="mt-3">
          {taxDisplay.kind === 'empty' ? (
            <button
              type="button"
              onClick={nav('/tax-estimator')}
              className="flex w-full items-center justify-between rounded-2xl border border-dashed border-white/10 px-4 py-3 text-left transition hover:border-blue-400/30"
            >
              <div className="flex items-center gap-3">
                <Gauge className="h-5 w-5 text-slate-500" />
                <div>
                  <div className="text-sm font-medium text-slate-300">Tax estimate</div>
                  <div className="text-xs text-slate-500">{taxDisplay.prompt}</div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-600" />
            </button>
          ) : (
            <button
              type="button"
              onClick={nav('/tax-estimator')}
              className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition hover:opacity-90 ${
                taxDisplay.kind === 'refund'
                  ? 'border-emerald-500/25 bg-emerald-500/8'
                  : 'border-amber-500/25 bg-amber-500/8'
              }`}
            >
              <div className="flex items-center gap-3">
                <Gauge className={`h-5 w-5 ${taxDisplay.kind === 'refund' ? 'text-emerald-400' : 'text-amber-400'}`} />
                <div>
                  <div className="text-xs text-slate-400">
                    {taxDisplay.kind === 'refund' ? 'Estimated refund' : 'Estimated amount owed'}
                  </div>
                  <div className={`text-xl font-semibold ${taxDisplay.kind === 'refund' ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {taxDisplay.display}
                  </div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-500" />
            </button>
          )}
        </section>

        {/* 5: Next best move ── */}
        {move && (
          <section className="mt-3">
            <button
              type="button"
              onClick={nav(move.route)}
              className="group w-full overflow-hidden rounded-2xl border border-blue-400/25 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_60%),linear-gradient(135deg,rgba(9,24,33,0.99),rgba(6,15,27,0.99))] p-4 text-left transition hover:border-blue-400/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600/30 text-blue-300">
                    <MoveIcon className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-[0.15em] text-blue-400">Next best move</div>
                    <div className="mt-0.5 font-semibold text-white">{move.title}</div>
                  </div>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-blue-300 transition group-hover:translate-x-1" />
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{move.detail}</p>
              {move.estimatedImpact && (
                <div className="mt-2 text-xs text-blue-300">
                  Estimated impact: {move.estimatedImpact}
                </div>
              )}
            </button>
          </section>
        )}

        {/* ── Metric cards (2-col grid) ── */}
        <section className="mt-5 grid grid-cols-2 gap-3">
          <MetricCard label="Cash" display={cashMetric} icon={Banknote} tone="green" onClick={nav('/banking')} />
          <MetricCard label="Investments" display={investMetric} icon={TrendingUp} tone="blue" onClick={nav('/investments')} />
          <MetricCard label="Retirement" display={retirementMetric} icon={PiggyBank} tone="purple" onClick={nav('/investments')} />
          <MetricCard label="Total debt" display={debtMetric} icon={CreditCard} tone="red" onClick={nav('/debts')} />
          <MetricCard label="Credit utilization" display={utilizationMetric} icon={WalletCards} tone="amber" onClick={nav('/debts')} />
          <MetricCard label="Emergency fund" display={emergencyMetric} icon={ShieldCheck} tone="green" onClick={nav('/banking')} />
        </section>

        {/* ── Monthly cash flow breakdown ── */}
        <section className="mt-4 rounded-3xl border border-white/8 bg-white/[0.035] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Monthly cash flow</h2>
            <CircleDollarSign className="h-4 w-4 text-blue-300" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                { label: 'Income',       display: incomeMetric,  color: 'text-emerald-300', onClick: nav('/scanner') },
                { label: 'Bills',        display: billsMetric,   color: 'text-rose-300',    onClick: nav('/bills') },
                { label: 'Debt pmts',    display: debtPayMetric, color: 'text-rose-300',    onClick: nav('/debts') },
                { label: 'Surplus',      display: cashFlow
                    ? { kind: 'value' as const, display: cashFlow.display }
                    : { kind: 'empty' as const, prompt: '—' },
                  color: cashFlow?.isNegative ? 'text-rose-300' : 'text-blue-300',
                  onClick: undefined },
              ] as const
            ).map(({ label, display, color, onClick }) => (
              <div key={label}>
                <div className="text-xs text-slate-500">{label}</div>
                {display.kind === 'value' ? (
                  <div className={`mt-1 font-semibold ${color}`}>{display.display}</div>
                ) : (
                  <div className="mt-1">
                    <EmptyCell prompt={display.prompt} onClick={onClick} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {cashFlow && (
            <>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                {(() => {
                  const income = summary?.monthlyIncome.value;
                  const surplus = summary?.monthlyCashFlow.value;
                  const pct = income && income > 0 && surplus !== null && surplus !== undefined
                    ? Math.max(0, Math.min(100, Math.round((surplus / income) * 100)))
                    : 0;
                  return (
                    <div
                      className={`h-full rounded-full ${cashFlow.isNegative ? 'bg-rose-500' : 'bg-gradient-to-r from-blue-500 to-emerald-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  );
                })()}
              </div>
            </>
          )}
        </section>

        {/* ── Quick actions ── */}
        <section className="mt-5">
          <h2 className="mb-3 font-semibold">Quick actions</h2>
          <div className="grid grid-cols-2 gap-3">
            <QuickAction primary label="Scan documents"    detail="Update everything with AI"     icon={FileScan}    onClick={nav('/scanner')} />
            <QuickAction        label="Ask Blue Collar AI" detail="Get a personalized answer"    icon={Bot}         onClick={nav('/ask-ai')} />
            <QuickAction        label="Run a scenario"     detail="Test your next move"           icon={Gauge}       onClick={nav('/scenario')} />
            <QuickAction        label="View accounts"      detail="Cash, debt and investing"      icon={WalletCards} onClick={nav('/banking')} />
          </div>
        </section>

      </div>
    </div>
  );
}
