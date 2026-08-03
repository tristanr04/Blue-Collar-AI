/**
 * TestLab.tsx — Developer-only Scanner Test Lab
 *
 * Access: /test-lab (no nav link — direct URL only)
 *
 * Runs synthetic fixture documents through the real scan API and reports
 * pass/fail metrics by category, document type, and field.
 */

import React, { useReducer, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'wouter';
import {
  FlaskConical, Play, Square, RefreshCw, Download, Trash2,
  ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertTriangle,
  Clock, Loader2, X, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FIXTURES, FIXTURE_CATEGORIES, type ScannerTestFixture, type FixtureCategory } from '@/lib/testFixtures';
import { runFixture, runAll, type TestResult, type FieldResult } from '@/lib/testRunner';

// ─── State ────────────────────────────────────────────────────────────────────

interface LabState {
  results: Record<string, TestResult>;
  running: Set<string>;
  concurrency: number;
  stopped: boolean;
}

type LabAction =
  | { type: 'START_RUNNING'; ids: string[] }
  | { type: 'MARK_RUNNING'; id: string }
  | { type: 'RESULT'; result: TestResult }
  | { type: 'STOP' }
  | { type: 'CLEAR' }
  | { type: 'SET_CONCURRENCY'; n: number };

function labReducer(state: LabState, action: LabAction): LabState {
  switch (action.type) {
    case 'START_RUNNING':
      return {
        ...state,
        stopped: false,
        running: new Set(action.ids),
      };
    case 'MARK_RUNNING': {
      const running = new Set(state.running);
      running.add(action.id);
      return { ...state, running };
    }
    case 'RESULT': {
      const running = new Set(state.running);
      running.delete(action.result.fixtureId);
      return {
        ...state,
        running,
        results: { ...state.results, [action.result.fixtureId]: action.result },
      };
    }
    case 'STOP':
      return { ...state, stopped: true, running: new Set() };
    case 'CLEAR':
      return { ...state, results: {}, running: new Set(), stopped: false };
    case 'SET_CONCURRENCY':
      return { ...state, concurrency: Math.min(Math.max(action.n, 1), 3) };
    default:
      return state;
  }
}

const initialState: LabState = {
  results: {},
  running: new Set(),
  concurrency: 2,
  stopped: false,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(n: number) { return `${Math.round(n * 100)}%`; }

function statusColor(status: TestResult['status']) {
  switch (status) {
    case 'passed': return 'text-emerald-600 dark:text-emerald-400';
    case 'failed': return 'text-amber-600 dark:text-amber-400';
    case 'error':  return 'text-red-600 dark:text-red-400';
    case 'running': return 'text-blue-500';
    default: return 'text-muted-foreground';
  }
}

function statusBg(status: TestResult['status']) {
  switch (status) {
    case 'passed': return 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800';
    case 'failed': return 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800';
    case 'error':  return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
    default: return 'bg-card border-border';
  }
}

function StatusIcon({ status, size = 4 }: { status: TestResult['status'] | 'running' | 'pending'; size?: number }) {
  const cls = `w-${size} h-${size}`;
  if (status === 'passed') return <CheckCircle2 className={`${cls} text-emerald-600`} />;
  if (status === 'failed') return <AlertTriangle className={`${cls} text-amber-500`} />;
  if (status === 'error')  return <XCircle className={`${cls} text-red-500`} />;
  if (status === 'running') return <Loader2 className={`${cls} text-blue-500 animate-spin`} />;
  return <div className={`${cls} rounded-full border-2 border-border`} />;
}

// ─── Summary metrics ──────────────────────────────────────────────────────────

function useSummaryMetrics(results: Record<string, TestResult>, running: Set<string>) {
  return useMemo(() => {
    const all = Object.values(results);
    const total = all.length;
    if (total === 0) return null;

    const passed = all.filter(r => r.status === 'passed').length;
    const failed = all.filter(r => r.status === 'failed' || r.status === 'error').length;
    const needsReview = all.filter(r => r.status === 'failed').length;
    const errored = all.filter(r => r.status === 'error').length;

    const docTypeMatches = all.filter(r => r.docTypeMatch).length;
    const classAccuracy = docTypeMatches / total;

    const allFieldResults: FieldResult[] = all.flatMap(r => r.fieldResults);
    const fieldAcc = allFieldResults.length > 0
      ? allFieldResults.filter(f => f.pass).length / allFieldResults.length
      : 0;

    const routingMatches = all.filter(r => r.routingMatch).length;
    const routingAcc = routingMatches / total;

    const avgMs = total > 0 ? all.reduce((s, r) => s + r.durationMs, 0) / total : 0;

    return { total, passed, failed, needsReview, errored, classAccuracy, fieldAcc, routingAcc, avgMs, running: running.size };
  }, [results, running]);
}

// ─── Export helpers ───────────────────────────────────────────────────────────

function exportJson(results: Record<string, TestResult>) {
  const blob = new Blob([JSON.stringify(Object.values(results), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scanner-test-results-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv(results: Record<string, TestResult>, fixtures: ScannerTestFixture[]) {
  const rows: string[][] = [
    ['id', 'name', 'category', 'status', 'docTypeExpected', 'docTypeActual', 'docTypeMatch',
     'institutionExpected', 'institutionActual', 'institutionMatch',
     'fieldPassRate', 'routingMatch', 'durationMs', 'retries', 'error'],
  ];
  for (const f of fixtures) {
    const r = results[f.id];
    if (!r) continue;
    const fp = r.fieldResults.length > 0
      ? r.fieldResults.filter(x => x.pass).length / r.fieldResults.length
      : 0;
    rows.push([
      f.id, f.name, f.category, r.status,
      f.expectedDocType, r.docTypeActual ?? '', String(r.docTypeMatch),
      f.expectedInstitution ?? '', r.institutionActual ?? '', String(r.institutionMatch ?? ''),
      pct(fp), String(r.routingMatch),
      String(r.durationMs), String(r.retries), r.error ?? '',
    ]);
  }
  const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scanner-test-results-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Field result row ─────────────────────────────────────────────────────────

function FieldRow({ fr }: { fr: FieldResult }) {
  const expectedStr = typeof fr.expected.value === 'number'
    ? (fr.expected.toleranceType === 'dollar' ? `$${fr.expected.value.toFixed(2)}` : String(fr.expected.value))
    : fr.expected.value;
  const actualStr = fr.actual !== null
    ? (typeof fr.actual === 'number' && fr.expected.toleranceType === 'dollar'
      ? `$${fr.actual.toFixed(2)}`
      : String(fr.actual))
    : '—';

  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs ${fr.pass ? 'bg-emerald-50 dark:bg-emerald-900/10' : 'bg-red-50 dark:bg-red-900/10'}`}>
      <span className={`w-4 h-4 flex-shrink-0 ${fr.pass ? 'text-emerald-600' : 'text-red-500'}`}>
        {fr.pass ? '✓' : '✗'}
      </span>
      <span className="font-mono text-muted-foreground w-36 flex-shrink-0">{fr.key}</span>
      <span className="text-muted-foreground flex-shrink-0">expected:</span>
      <span className="font-semibold text-foreground w-24">{expectedStr}</span>
      {fr.expected.tolerance !== undefined && (
        <span className="text-muted-foreground text-[10px] flex-shrink-0">±{fr.expected.tolerance}</span>
      )}
      <span className="text-muted-foreground flex-shrink-0">got:</span>
      <span className={`font-semibold w-24 ${fr.actual === null ? 'text-red-400' : fr.pass ? 'text-foreground' : 'text-red-600'}`}>
        {actualStr}
      </span>
      <span className="text-muted-foreground ml-auto flex-shrink-0">{Math.round(fr.confidence * 100)}% conf</span>
    </div>
  );
}

// ─── Expandable failure report ────────────────────────────────────────────────

function FailureReport({ result, fixture }: { result: TestResult; fixture: ScannerTestFixture }) {
  return (
    <div className="mt-3 space-y-3 pl-4 border-l-2 border-muted">
      {/* Error */}
      {result.error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <div className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">
            Error — stage: {result.errorStage ?? 'unknown'}
          </div>
          <div className="text-xs text-red-600 dark:text-red-300 font-mono break-all">{result.error}</div>
          {result.retryHistory.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="text-xs font-semibold text-red-600">Retry history:</div>
              {result.retryHistory.map((h, i) => (
                <div key={i} className="text-[11px] text-red-500 font-mono">{h}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Classification mismatch */}
      {!result.docTypeMatch && result.docTypeActual && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-lg p-3 text-xs">
          <div className="font-semibold text-amber-700 dark:text-amber-400 mb-1">Classification mismatch</div>
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-muted-foreground">Expected:</span> <span className="font-mono font-semibold">{fixture.expectedDocType}</span></div>
            <div><span className="text-muted-foreground">Actual:</span> <span className="font-mono font-semibold text-amber-700">{result.docTypeActual}</span></div>
          </div>
        </div>
      )}

      {/* Institution mismatch */}
      {result.institutionMatch === false && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-lg p-3 text-xs">
          <div className="font-semibold text-amber-700 dark:text-amber-400 mb-1">Institution mismatch</div>
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-muted-foreground">Expected:</span> <span className="font-mono font-semibold">{fixture.expectedInstitution}</span></div>
            <div><span className="text-muted-foreground">Actual:</span> <span className="font-mono font-semibold text-amber-700">{result.institutionActual ?? '—'}</span></div>
          </div>
        </div>
      )}

      {/* Field results */}
      {result.fieldResults.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-muted-foreground">Field extraction:</div>
          {result.fieldResults.map(fr => <FieldRow key={fr.key} fr={fr} />)}
        </div>
      )}

      {/* Routing */}
      {!result.routingMatch && (
        <div className="text-xs bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-lg p-3">
          <span className="font-semibold text-amber-700">Routing mismatch: </span>
          <span>expected <code>{fixture.expectedDestination}</code>, got <code>{result.routingActual ?? '—'}</code></span>
        </div>
      )}

      {/* Full-flow */}
      {result.fullFlowResult && (
        <div className={`text-xs border rounded-lg p-3 ${result.fullFlowResult.pass ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200' : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200'}`}>
          <div className="font-semibold mb-1">
            Full-flow: {result.fullFlowResult.pass ? '✓ Pass' : '✗ Fail'}
          </div>
          <div className="text-muted-foreground">{result.fullFlowResult.detail}</div>
        </div>
      )}

      {/* Raw API response */}
      {result.rawApiResponse && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Raw API response
          </summary>
          <pre className="mt-2 bg-muted rounded-lg p-3 overflow-x-auto text-[10px] max-h-64">
            {JSON.stringify(result.rawApiResponse, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ─── Result row ───────────────────────────────────────────────────────────────

function ResultRow({ fixture, result, running, onRunOne }: {
  fixture: ScannerTestFixture;
  result: TestResult | null;
  running: boolean;
  onRunOne: (fixture: ScannerTestFixture) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const status: TestResult['status'] | 'running' | 'pending' =
    running ? 'running' : result?.status ?? 'pending';
  const hasProblem = result && (result.status === 'failed' || result.status === 'error');
  const fpPct = result && result.fieldResults.length > 0
    ? result.fieldResults.filter(f => f.pass).length / result.fieldResults.length
    : null;

  return (
    <div className={`rounded-xl border ${statusBg(result?.status ?? 'pending')} overflow-hidden transition-all`}>
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
        onClick={() => hasProblem && setExpanded(e => !e)}
      >
        <StatusIcon status={status} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{fixture.name}</div>
          {result && !running && (
            <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
              <span>{result.docTypeActual ?? '—'}</span>
              {result.institutionActual && <span>· {result.institutionActual}</span>}
              {fpPct !== null && <span>· fields {pct(fpPct)}</span>}
              <span>· {result.durationMs}ms</span>
              {result.retries > 0 && <span>· {result.retries} retry</span>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Check indicators */}
          {result && !running && (
            <div className="flex gap-1 text-[10px]">
              <span title="Classification" className={`px-1.5 py-0.5 rounded font-mono ${result.docTypeMatch ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                cls
              </span>
              {result.institutionMatch !== null && (
                <span title="Institution" className={`px-1.5 py-0.5 rounded font-mono ${result.institutionMatch ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                  inst
                </span>
              )}
              <span title="Routing" className={`px-1.5 py-0.5 rounded font-mono ${result.routingMatch ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                route
              </span>
              {result.fullFlowResult && (
                <span title="Full flow" className={`px-1.5 py-0.5 rounded font-mono ${result.fullFlowResult.pass ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                  flow
                </span>
              )}
            </div>
          )}
          {/* Per-row Run One button */}
          {!running && (
            <button
              onClick={e => { e.stopPropagation(); onRunOne(fixture); }}
              className="p-1.5 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors"
              title="Run this fixture"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          )}
          {hasProblem && (
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
          )}
        </div>
      </div>

      {expanded && hasProblem && result && (
        <div className="border-t border-border px-4 py-3">
          <FailureReport result={result} fixture={fixture} />
        </div>
      )}
    </div>
  );
}

// ─── Category section ────────────────────────────────────────────────────────

function CategorySection({
  category,
  fixtures,
  results,
  running,
  onRunOne,
}: {
  category: FixtureCategory;
  fixtures: ScannerTestFixture[];
  results: Record<string, TestResult>;
  running: Set<string>;
  onRunOne: (fixture: ScannerTestFixture) => void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const catResults = fixtures.map(f => results[f.id]).filter(Boolean);
  const passed = catResults.filter(r => r.status === 'passed').length;
  const total = fixtures.length;

  return (
    <div className="space-y-2">
      <button
        className="flex items-center gap-2 w-full text-left"
        onClick={() => setCollapsed(c => !c)}
      >
        {collapsed ? <ChevronRight className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        <span className="font-semibold text-foreground">{category}</span>
        <span className="text-xs text-muted-foreground ml-1">
          {catResults.length > 0 ? `${passed}/${total} passed` : `${total} fixtures`}
        </span>
        {catResults.length > 0 && (
          <div className="ml-auto flex-shrink-0 w-24 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${total > 0 ? (passed / total) * 100 : 0}%` }}
            />
          </div>
        )}
      </button>

      {!collapsed && (
        <div className="space-y-2 pl-2">
          {fixtures.map(f => (
            <ResultRow
              key={f.id}
              fixture={f}
              result={results[f.id] ?? null}
              running={running.has(f.id)}
              onRunOne={onRunOne}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Summary bar ──────────────────────────────────────────────────────────────

function SummaryBar({ metrics }: {
  metrics: ReturnType<typeof useSummaryMetrics>;
}) {
  if (!metrics) {
    return (
      <div className="bg-muted/50 border border-border rounded-2xl p-5 text-center text-sm text-muted-foreground">
        Run tests to see metrics
      </div>
    );
  }

  const cards = [
    {
      label: 'Overall Pass Rate',
      value: pct(metrics.total > 0 ? metrics.passed / metrics.total : 0),
      sub: `${metrics.passed} / ${metrics.total} tests`,
      color: metrics.passed / metrics.total >= 0.9 ? 'emerald' : metrics.passed / metrics.total >= 0.7 ? 'amber' : 'red',
    },
    {
      label: 'Classification',
      value: pct(metrics.classAccuracy),
      sub: 'doc-type accuracy',
      color: metrics.classAccuracy >= 0.9 ? 'emerald' : 'amber',
    },
    {
      label: 'Field Extraction',
      value: pct(metrics.fieldAcc),
      sub: 'field pass rate',
      color: metrics.fieldAcc >= 0.9 ? 'emerald' : 'amber',
    },
    {
      label: 'Routing',
      value: pct(metrics.routingAcc),
      sub: 'correct destination',
      color: metrics.routingAcc >= 0.95 ? 'emerald' : 'amber',
    },
    {
      label: 'Avg Time',
      value: `${(metrics.avgMs / 1000).toFixed(1)}s`,
      sub: 'per document',
      color: 'blue',
    },
    {
      label: 'Status',
      value: `${metrics.passed}P · ${metrics.failed}F · ${metrics.errored}E`,
      sub: metrics.running > 0 ? `${metrics.running} running…` : 'complete',
      color: metrics.running > 0 ? 'blue' : metrics.failed + metrics.errored === 0 ? 'emerald' : 'amber',
    },
  ];

  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-700 dark:text-emerald-400',
    amber: 'text-amber-700 dark:text-amber-400',
    red: 'text-red-700 dark:text-red-400',
    blue: 'text-blue-600 dark:text-blue-400',
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map(c => (
        <div key={c.label} className="bg-card border border-border rounded-xl p-3 text-center">
          <div className={`text-2xl font-bold ${colorMap[c.color]}`}>{c.value}</div>
          <div className="text-xs font-medium text-foreground mt-0.5">{c.label}</div>
          <div className="text-xs text-muted-foreground">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TestLab() {
  const [, setLocation] = useLocation();
  const [state, dispatch] = useReducer(labReducer, initialState);
  const abortRef = useRef<AbortController | null>(null);
  const [selectedCategory, setSelectedCategory] = React.useState<FixtureCategory | 'all'>('all');

  const metrics = useSummaryMetrics(state.results, state.running);
  const isRunning = state.running.size > 0;

  const fixturesByCategory = useMemo(() =>
    FIXTURE_CATEGORIES.reduce((acc, cat) => {
      acc[cat] = FIXTURES.filter(f => f.category === cat);
      return acc;
    }, {} as Record<FixtureCategory, ScannerTestFixture[]>),
  []);

  const startRun = useCallback((fixtures: ScannerTestFixture[]) => {
    if (isRunning) return;
    abortRef.current = new AbortController();
    const ids = fixtures.map(f => f.id);
    dispatch({ type: 'START_RUNNING', ids });

    runAll(fixtures, {
      concurrency: state.concurrency,
      signal: abortRef.current.signal,
      onStart: (id) => dispatch({ type: 'MARK_RUNNING', id }),
      onResult: (result) => dispatch({ type: 'RESULT', result }),
    });
  }, [isRunning, state.concurrency]);

  const stopRun = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: 'STOP' });
  }, []);

  const runAll_ = useCallback(() => {
    const fixtures = selectedCategory === 'all'
      ? FIXTURES
      : FIXTURES.filter(f => f.category === selectedCategory);
    startRun(fixtures);
  }, [startRun, selectedCategory]);

  const runFailed = useCallback(() => {
    const failed = FIXTURES.filter(f => {
      const r = state.results[f.id];
      return r && (r.status === 'failed' || r.status === 'error');
    });
    if (failed.length > 0) startRun(failed);
  }, [startRun, state.results]);

  const runOne = useCallback((fixture: ScannerTestFixture) => {
    if (isRunning) return;
    startRun([fixture]);
  }, [isRunning, startRun]);

  const failedCount = Object.values(state.results).filter(r => r.status === 'failed' || r.status === 'error').length;

  const visibleCategories: FixtureCategory[] = selectedCategory === 'all'
    ? FIXTURE_CATEGORIES
    : [selectedCategory];

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-slate-900 text-white px-4 py-3 flex items-center gap-3 border-b border-slate-700">
        <button
          onClick={() => setLocation('/')}
          className="p-2 rounded-full hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <FlaskConical className="w-5 h-5 text-emerald-400" />
        <div>
          <h1 className="font-bold text-base leading-none">Scanner Test Lab</h1>
          <p className="text-slate-400 text-xs mt-0.5">Developer tool — direct URL access only</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded font-mono">
            {FIXTURES.length} fixtures
          </span>
          {isRunning && (
            <span className="text-xs text-blue-400 bg-blue-900/40 px-2 py-1 rounded flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              {state.running.size} running
            </span>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Summary */}
        <SummaryBar metrics={metrics} />

        {/* Controls */}
        <div className="flex flex-wrap gap-2 items-center">
          <Button
            className="h-10 bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={runAll_}
            disabled={isRunning}
          >
            <Play className="w-4 h-4 mr-1.5" />
            Run {selectedCategory === 'all' ? 'All' : selectedCategory}
          </Button>

          {failedCount > 0 && !isRunning && (
            <Button
              variant="outline"
              className="h-10 border-amber-400 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
              onClick={runFailed}
            >
              <RefreshCw className="w-4 h-4 mr-1.5" />
              Retry {failedCount} Failed
            </Button>
          )}

          {isRunning && (
            <Button
              variant="outline"
              className="h-10 border-red-400 text-red-600 hover:bg-red-50"
              onClick={stopRun}
            >
              <Square className="w-4 h-4 mr-1.5" />
              Stop
            </Button>
          )}

          {/* Category filter */}
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value as FixtureCategory | 'all')}
            className="h-10 rounded-lg border border-border bg-background text-sm px-3 text-foreground"
            disabled={isRunning}
          >
            <option value="all">All Categories</option>
            {FIXTURE_CATEGORIES.map(c => (
              <option key={c} value={c}>{c} ({fixturesByCategory[c].length})</option>
            ))}
          </select>

          {/* Concurrency */}
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-muted-foreground">Concurrency:</span>
            {[1, 2, 3].map(n => (
              <button
                key={n}
                onClick={() => dispatch({ type: 'SET_CONCURRENCY', n })}
                disabled={isRunning}
                className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                  state.concurrency === n
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          {/* Export / Clear */}
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-muted-foreground"
              disabled={Object.keys(state.results).length === 0}
              onClick={() => exportJson(state.results)}
              title="Export JSON"
            >
              <Download className="w-4 h-4 mr-1" /> JSON
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-muted-foreground"
              disabled={Object.keys(state.results).length === 0}
              onClick={() => exportCsv(state.results, FIXTURES)}
              title="Export CSV"
            >
              <Download className="w-4 h-4 mr-1" /> CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-muted-foreground"
              disabled={Object.keys(state.results).length === 0 || isRunning}
              onClick={() => dispatch({ type: 'CLEAR' })}
              title="Clear results"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Results by category */}
        <div className="space-y-6">
          {visibleCategories.map(cat => (
            <CategorySection
              key={cat}
              category={cat}
              fixtures={fixturesByCategory[cat]}
              results={state.results}
              running={state.running}
              onRunOne={runOne}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
