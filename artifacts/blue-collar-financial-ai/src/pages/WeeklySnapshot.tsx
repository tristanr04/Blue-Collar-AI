import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/react';
import { useLocation } from 'wouter';
import { AlertCircle, Calendar, RefreshCw, TrendingUp } from 'lucide-react';
import { useStore } from '@/lib/store';
import { getWeeklySnapshotCurrent, getWeeklySnapshotHistory, type WeeklySnapshotSummary, type StoredWeeklySnapshot } from '@/lib/api';

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  const bar = (cls: string) => <div className={`animate-pulse rounded-xl bg-white/[0.06] ${cls}`} />;
  return (
    <div className="mx-auto max-w-2xl px-4 pb-28 pt-5 md:px-6 md:pb-10 md:pt-8 space-y-4">
      {bar('h-7 w-48')}
      {bar('h-40 w-full rounded-3xl')}
      {[1,2,3].map(i => bar(`h-20 w-full rounded-2xl key-${i}`))}
    </div>
  );
}

// ─── Error banner ─────────────────────────────────────────────────────────────

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-4 mt-4 flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-rose-300">Could not load weekly snapshot</div>
        <div className="mt-0.5 text-sm text-rose-400/80">{message}</div>
      </div>
      <button type="button" onClick={onRetry} aria-label="Retry"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10">
        <RefreshCw className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Sentence bullet ──────────────────────────────────────────────────────────

function SentenceBullet({ text }: { text: string }) {
  const isPositive = /increased|gained|grew|improved/i.test(text);
  const isNegative = /decreased|dropped|fell|declined/i.test(text);
  const color = isPositive ? 'text-emerald-300' : isNegative ? 'text-rose-300' : 'text-slate-300';
  const dot = isPositive ? 'bg-emerald-500' : isNegative ? 'bg-rose-500' : 'bg-slate-500';
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className={`text-sm leading-relaxed ${color}`}>{text}</span>
    </div>
  );
}

// ─── Current week card ────────────────────────────────────────────────────────

function CurrentWeekCard({ snapshot }: { snapshot: WeeklySnapshotSummary }) {
  const weekStart = new Date(snapshot.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekEnd = new Date(snapshot.weekEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#0a1829] to-[#060f1b] p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-semibold text-white">This week</span>
        </div>
        <span className="text-xs text-slate-500">{weekStart} – {weekEnd}</span>
      </div>
      <div className="space-y-2.5">
        {snapshot.sentences.map((s, i) => <SentenceBullet key={i} text={s} />)}
      </div>
    </section>
  );
}

// ─── History card ─────────────────────────────────────────────────────────────

function HistoryCard({ snapshot }: { snapshot: StoredWeeklySnapshot }) {
  const weekStart = new Date(snapshot.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekEnd = new Date(snapshot.weekEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const [open, setOpen] = useState(false);

  if (!snapshot.sentences || snapshot.sentences.length === 0) return null;

  const preview = snapshot.sentences[0];

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-start justify-between gap-3 p-4 text-left"
      >
        <div>
          <div className="text-xs text-slate-500">{weekStart} – {weekEnd}</div>
          <div className="mt-0.5 text-sm text-slate-300">{preview}</div>
        </div>
        <span className="text-xs text-slate-600">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-white/8 px-4 pb-4 pt-3 space-y-2">
          {snapshot.sentences.map((s, i) => <SentenceBullet key={i} text={s} />)}
        </div>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyHistory() {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 py-10 text-center">
      <Calendar className="mx-auto mb-3 h-7 w-7 text-slate-600" />
      <p className="text-sm text-slate-500">Previous snapshots will appear here over time.</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WeeklySnapshot() {
  const [, setLocation] = useLocation();
  const { profile } = useStore();
  const { getToken, isLoaded } = useAuth();

  const [current, setCurrent] = useState<WeeklySnapshotSummary | null>(null);
  const [history, setHistory] = useState<StoredWeeklySnapshot[]>([]);
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
      const [cur, hist] = await Promise.all([
        getWeeklySnapshotCurrent(token),
        getWeeklySnapshotHistory(token),
      ]);
      setCurrent(cur.current);
      setHistory(hist.history);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Weekly snapshot could not be loaded right now.');
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
            <TrendingUp className="h-4 w-4" /> Weekly Summary
          </div>
          <h1 className="text-2xl font-semibold">Weekly Snapshot</h1>
          <p className="mt-1 text-sm text-slate-500">What changed in your finances this week.</p>
        </header>

        {apiError && <ErrorBanner message={apiError} onRetry={fetchData} />}

        {!apiError && (
          <div className="space-y-4">
            {current && <CurrentWeekCard snapshot={current} />}

            {/* History */}
            <section>
              <h2 className="mb-3 font-semibold text-slate-200">Previous weeks</h2>
              {history.length === 0 ? (
                <EmptyHistory />
              ) : (
                <div className="space-y-3">
                  {history.map((h) => <HistoryCard key={h.id} snapshot={h} />)}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
