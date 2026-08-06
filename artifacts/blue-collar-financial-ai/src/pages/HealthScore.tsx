import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/react';
import { useLocation } from 'wouter';
import {
  Activity, AlertCircle, ArrowRight, CheckCircle2,
  RefreshCw, ShieldCheck, TrendingUp,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import {
  getHealthScoreDetail,
  getHealthScoreHistory,
  type HealthScoreResult,
  type HealthScoreHistoryEntry,
} from '@/lib/api';

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  const bar = (cls: string) => (
    <div className={`animate-pulse rounded-xl bg-white/[0.06] ${cls}`} />
  );
  return (
    <div className="mx-auto max-w-2xl px-4 pb-28 pt-5 md:px-6 md:pb-10 md:pt-8 space-y-4">
      {bar('h-7 w-40')}
      {bar('h-56 w-full rounded-3xl')}
      {bar('h-40 w-full rounded-3xl')}
      {[1,2,3,4,5].map(i => bar(`h-16 w-full rounded-2xl key-${i}`))}
    </div>
  );
}

// ─── Error banner ─────────────────────────────────────────────────────────────

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-4 mt-4 flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-rose-300">Could not load health score</div>
        <div className="mt-0.5 text-sm text-rose-400/80">{message}</div>
      </div>
      <button type="button" onClick={onRetry} aria-label="Retry"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10">
        <RefreshCw className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Score ring ───────────────────────────────────────────────────────────────

function scoreColor(score: number | null): string {
  if (score === null) return '#334155';
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#3b82f6';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function scoreLabel(score: number | null): string {
  if (score === null) return 'No data yet';
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Needs work';
}

function ScoreRing({ score, confidence }: { score: number | null; confidence: number }) {
  const color = scoreColor(score);
  const degrees = score !== null ? score * 3.6 : 0;
  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#0a1829] to-[#060f1b] p-6">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
        {/* Ring */}
        <div
          aria-label={score !== null ? `Financial health score: ${score} out of 100` : 'Health score not yet available'}
          role="img"
          className="relative flex h-36 w-36 shrink-0 items-center justify-center rounded-full"
          style={{
            background: score !== null
              ? `conic-gradient(${color} ${degrees}deg, #172033 0deg)`
              : 'conic-gradient(#334155 360deg, #172033 0deg)',
          }}
        >
          <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-[#060f1b]">
            {score !== null ? (
              <>
                <span className="text-3xl font-bold text-white">{score}</span>
                <span className="text-xs text-slate-400">/ 100</span>
              </>
            ) : (
              <span className="text-center text-xs text-slate-500 px-2">Add data for score</span>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="text-center sm:text-left">
          <div className="text-sm font-medium uppercase tracking-[0.14em] text-blue-400">
            Financial Health Score
          </div>
          <div className="mt-1 text-2xl font-semibold" style={{ color: score !== null ? color : '#64748b' }}>
            {scoreLabel(score)}
          </div>

          {/* Confidence bar */}
          <div className="mt-4 w-full sm:w-48">
            <div className="mb-1 flex justify-between text-xs text-slate-500">
              <span>Data confidence</span>
              <span>{confidence}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${confidence}%`, background: color }}
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {confidence < 50
                ? 'Add more financial data to improve accuracy.'
                : confidence < 80
                ? 'Good data coverage. More records = higher confidence.'
                : 'High confidence — most of your financial picture is on file.'}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Recommendation card ──────────────────────────────────────────────────────

function RecommendationCard({
  rec,
  onNavigate,
}: {
  rec: HealthScoreResult['recommendation'];
  onNavigate: (route: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-blue-500/20 bg-blue-500/5 p-5">
      <div className="mb-2 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-blue-400" />
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-blue-400">Top recommendation</span>
      </div>
      <h2 className="font-semibold text-white">{rec.title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-400">{rec.detail}</p>
      <button
        type="button"
        onClick={() => onNavigate(rec.route)}
        className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-400 hover:text-blue-300"
      >
        Take action <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </section>
  );
}

// ─── Category row ─────────────────────────────────────────────────────────────

const CATEGORY_BAR_COLORS: Record<string, string> = {
  excellent:   '#10b981',
  good:        '#3b82f6',
  fair:        '#f59e0b',
  needs_work:  '#ef4444',
  missing:     '#334155',
};

function CategoryRow({ cat }: { cat: HealthScoreResult['categories'][number] }) {
  const color = CATEGORY_BAR_COLORS[cat.status] ?? '#334155';
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-slate-100">{cat.label}</div>
        <div className="flex shrink-0 items-center gap-2">
          {cat.hasData ? (
            <span className="text-sm font-semibold" style={{ color }}>
              {cat.score}/{cat.maxScore}
            </span>
          ) : (
            <span className="text-xs text-slate-500">No data</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: cat.hasData ? `${cat.pct}%` : '0%', background: color }}
        />
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-500">{cat.explanation}</p>
    </div>
  );
}

// ─── History section ──────────────────────────────────────────────────────────

function HistorySection({ history }: { history: HealthScoreHistoryEntry[] }) {
  if (history.length === 0) return null;

  const max = Math.max(...history.map((h) => h.score ?? 0), 1);
  const reversed = [...history].reverse(); // oldest first for chart

  return (
    <section>
      <h2 className="mb-3 font-semibold text-slate-200">Score history</h2>
      <div className="overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03] p-4">
        <div className="flex h-24 items-end gap-1.5">
          {reversed.map((entry) => {
            const h = entry.score !== null ? Math.max(4, Math.round((entry.score / max) * 96)) : 4;
            const color = scoreColor(entry.score);
            const label = entry.month.slice(0, 7); // YYYY-MM
            return (
              <div key={entry.month} className="group relative flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t-sm transition-all duration-500"
                  style={{ height: `${h}px`, background: color, opacity: 0.8 }}
                />
                {/* Tooltip on hover */}
                <div className="absolute -top-7 hidden rounded-lg bg-slate-800 px-2 py-1 text-xs text-white group-hover:block whitespace-nowrap">
                  {label}: {entry.score ?? '—'}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-slate-600">
          <span>{reversed[0]?.month ?? ''}</span>
          <span>{reversed[reversed.length - 1]?.month ?? ''}</span>
        </div>
      </div>
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HealthScore() {
  const [, setLocation] = useLocation();
  const { profile } = useStore();
  const { getToken, isLoaded } = useAuth();

  const [result, setResult] = useState<HealthScoreResult | null>(null);
  const [history, setHistory] = useState<HealthScoreHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.hasCompletedOnboarding) setLocation('/welcome');
  }, [profile, setLocation]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Session expired. Please sign in again.');
      const [detail, hist] = await Promise.all([
        getHealthScoreDetail(token),
        getHealthScoreHistory(token),
      ]);
      setResult(detail.healthScore);
      setHistory(hist.history);
    } catch (err) {
      setApiError(
        err instanceof Error ? err.message : 'Health score could not be loaded right now.',
      );
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (isLoaded && profile) void fetchData();
  }, [isLoaded, profile, fetchData]);

  if (!profile) return null;
  if (!isLoaded || loading) return <Skeleton />;

  return (
    <div className="min-h-full bg-[#050b15] text-white">
      <div className="mx-auto max-w-2xl px-4 pb-28 pt-5 md:px-6 md:pb-10 md:pt-8">

        {/* Header */}
        <header className="mb-5">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-blue-400">
            <ShieldCheck className="h-4 w-4" /> Financial Health
          </div>
          <h1 className="text-2xl font-semibold">Health Score</h1>
          <p className="mt-1 text-sm text-slate-500">
            10-category analysis of your financial picture.
          </p>
        </header>

        {apiError && <ErrorBanner message={apiError} onRetry={fetchData} />}

        {!apiError && result && (
          <div className="space-y-4">
            <ScoreRing score={result.score} confidence={result.confidence} />
            <RecommendationCard rec={result.recommendation} onNavigate={setLocation} />

            {/* Categories */}
            <section>
              <h2 className="mb-3 font-semibold text-slate-200">Category breakdown</h2>
              <div className="space-y-3">
                {result.categories.map((cat) => (
                  <CategoryRow key={cat.key} cat={cat} />
                ))}
              </div>
            </section>

            <HistorySection history={history} />
          </div>
        )}

      </div>
    </div>
  );
}
