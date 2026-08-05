import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/react';
import { useLocation } from 'wouter';
import {
  AlertCircle, ArrowDownLeft, ArrowUpRight, Banknote,
  BookOpen, RefreshCw, TrendingDown, TrendingUp,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { getTimelineSummary, type TimelineEvent, type MonthlyTrends } from '@/lib/api';
import {
  resolveChange, resolveTrend, getEventCategory,
  formatEventDate, buildTrendSentences, formatMoney,
} from '@/lib/timeline-utils';

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  const bar = (cls: string) => (
    <div className={`animate-pulse rounded-xl bg-white/[0.06] ${cls}`} />
  );
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-28 pt-5 md:px-6 md:pb-10 md:pt-8">
      {bar('h-7 w-40')}
      {bar('h-32 w-full rounded-3xl')}
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => bar(`h-20 w-full rounded-2xl key-${i}`))}
      </div>
    </div>
  );
}

// ─── Error banner ─────────────────────────────────────────────────────────────

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-4 mt-4 flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-rose-300">Could not load your timeline</div>
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

// ─── Monthly summary card ─────────────────────────────────────────────────────

function MonthlySummary({ trends }: { trends: MonthlyTrends }) {
  const sentences = buildTrendSentences(trends);

  const items: Array<{ label: string; value: number | null; tone: 'green' | 'red' | 'blue' | 'violet' | 'cyan'; invertSign?: boolean }> = [
    { label: 'Net worth',    value: trends.netWorth,     tone: trends.netWorth !== null && trends.netWorth < 0 ? 'red' : 'green' },
    { label: 'Cash',         value: trends.cash,         tone: 'blue' },
    { label: 'Debt',         value: trends.debt,         tone: 'red', invertSign: true },
    { label: 'Investments',  value: trends.investments,  tone: 'violet' },
    { label: 'Est. tax',     value: trends.estimatedTax, tone: 'cyan' },
  ];

  const tones = {
    green:  'text-emerald-300',
    red:    'text-rose-300',
    blue:   'text-blue-300',
    violet: 'text-violet-300',
    cyan:   'text-cyan-300',
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#0a1829] to-[#060f1b] p-5">
      <div className="mb-4 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-blue-400" />
        <h2 className="font-semibold text-white">This month&apos;s changes</h2>
      </div>

      {sentences.length > 0 && (
        <div className="mb-4 space-y-1">
          {sentences.map((s) => (
            <p key={s} className="text-sm text-slate-300">{s}</p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map(({ label, value, tone, invertSign }) => {
          const trend = resolveTrend(value, '—', !invertSign);
          return (
            <div key={label} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5">
              <div className="text-xs text-slate-500">{label}</div>
              {trend.kind === 'empty' ? (
                <div className="mt-0.5 text-sm text-slate-600">{trend.prompt}</div>
              ) : (
                <div className={`mt-0.5 flex items-center gap-1 text-sm font-semibold ${tones[tone]}`}>
                  {trend.kind === 'positive' ? (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  ) : trend.kind === 'negative' ? (
                    <ArrowDownLeft className="h-3.5 w-3.5" />
                  ) : null}
                  {trend.label}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Event card ───────────────────────────────────────────────────────────────

function EventCard({ event }: { event: TimelineEvent }) {
  const cat = getEventCategory(event.eventType);
  const change = resolveChange(event.changeAmount);
  const dateStr = formatEventDate(event.eventDate);

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <div className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm font-bold ${cat.bgClass} ${cat.colorClass}`}>
        {cat.label.charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="font-medium text-slate-100">{event.title}</div>
          {change.kind !== 'none' && (
            <span className={`shrink-0 text-sm font-semibold ${change.kind === 'increase' ? 'text-emerald-300' : 'text-rose-300'}`}>
              {change.label}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm leading-relaxed text-slate-400">{event.description}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <span className={`text-[10px] font-medium uppercase tracking-[0.12em] ${cat.colorClass}`}>{cat.label}</span>
          <span className="text-[10px] text-slate-600">·</span>
          <span className="text-[10px] text-slate-500">{dateStr}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onScan }: { onScan: () => void }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 px-6 py-12 text-center">
      <BookOpen className="mx-auto mb-3 h-8 w-8 text-slate-600" />
      <p className="text-sm font-medium text-slate-400">
        Upload or add financial information to start tracking your progress.
      </p>
      <button
        type="button"
        onClick={onScan}
        className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
      >
        Scan a document
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Timeline() {
  const [, setLocation] = useLocation();
  const { profile } = useStore();
  const { getToken, isLoaded } = useAuth();

  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [trends, setTrends] = useState<MonthlyTrends | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.hasCompletedOnboarding) setLocation('/welcome');
  }, [profile, setLocation]);

  const fetchTimeline = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Session expired. Please sign in again.');
      const data = await getTimelineSummary(token);
      setEvents(data.events);
      setTrends(data.monthlyTrends);
    } catch (err) {
      setApiError(
        err instanceof Error
          ? err.message
          : 'Your financial timeline could not be loaded right now.',
      );
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (isLoaded && profile) void fetchTimeline();
  }, [isLoaded, profile, fetchTimeline]);

  if (!profile) return null;
  if (!isLoaded || loading) return <Skeleton />;

  const hasEvents = Array.isArray(events) && events.length > 0;

  return (
    <div className="min-h-full bg-[#050b15] text-white">
      <div className="mx-auto max-w-2xl px-4 pb-28 pt-5 md:px-6 md:pb-10 md:pt-8">

        {/* Header */}
        <header className="mb-5">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-blue-400">
            <TrendingUp className="h-4 w-4" /> Financial Timeline
          </div>
          <h1 className="text-2xl font-semibold">What changed</h1>
          <p className="mt-1 text-sm text-slate-500">A record of every update to your financial picture.</p>
        </header>

        {/* API error */}
        {apiError && <ErrorBanner message={apiError} onRetry={fetchTimeline} />}

        {/* Monthly summary */}
        {trends && !apiError && (
          <MonthlySummary trends={trends} />
        )}

        {/* Event list */}
        <section className="mt-5">
          <h2 className="mb-3 font-semibold text-slate-200">Recent events</h2>

          {!hasEvents ? (
            <EmptyState onScan={() => setLocation('/scanner')} />
          ) : (
            <div className="space-y-3">
              {events!.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
