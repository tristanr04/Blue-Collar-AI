import { Target, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  compareToAgeMedian,
  findAgeBenchmark,
  overallAgeBenchmarkScore,
  type BenchmarkComparison,
  type BenchmarkMetric,
} from '@/lib/age-benchmarks';
import { AGE_BENCHMARKS, BENCHMARK_DISCLOSURE } from '@/lib/age-benchmark-data';

interface AgeBenchmarkCardProps {
  age: number | null;
  annualGrossIncome: number | null;
  netWorth: number | null;
  /** ISO-3166-2 state code (e.g. "OK"). When present, shows national comparison
   *  with a note that state-level comparison is coming. */
  stateCode?: string | null;
}

const LABELS: Record<BenchmarkMetric, string> = {
  annualGrossIncome: 'Annual gross income',
  netWorth: 'Net worth',
  liquidSavings: 'Liquid savings',
  investmentAssets: 'Investments',
  debtToIncome: 'Debt-to-income',
  emergencyFundMonths: 'Emergency fund',
};

const STANDING_LABELS: Record<BenchmarkComparison['standing'], string> = {
  'far-behind': 'Far behind median',
  behind: 'Behind median',
  'near-median': 'Near median',
  ahead: 'Ahead of median',
  'far-ahead': 'Far ahead of median',
};

function money(value: number): string {
  return value < 0
    ? `-$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function buildComparison(age: number, metric: BenchmarkMetric, value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  const benchmark = findAgeBenchmark([...AGE_BENCHMARKS], metric, age);
  return benchmark ? compareToAgeMedian(value, benchmark) : null;
}

function MetricRow({ comparison }: { comparison: BenchmarkComparison }) {
  const direction = comparison.difference >= 0 ? 'ahead' : 'behind';
  const absoluteDifference = Math.abs(comparison.difference);

  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-900 dark:text-white">
            {LABELS[comparison.metric]}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            You: {money(comparison.userValue)} · Median: {money(comparison.benchmarkMedian)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">{comparison.score}/100</div>
          <div className="text-[11px] text-slate-500">{STANDING_LABELS[comparison.standing]}</div>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${comparison.score}%` }}
          aria-label={`${LABELS[comparison.metric]} comparison score ${comparison.score} out of 100`}
        />
      </div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400">
        {money(absoluteDifference)} {direction} the {comparison.ageBand.label} national median · {comparison.source.year}
      </div>
    </div>
  );
}

export function AgeBenchmarkCard({ age, annualGrossIncome, netWorth, stateCode }: AgeBenchmarkCardProps) {
  if (age === null) {
    return (
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-emerald-600" /> Your Age Benchmark
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-500">
          Add your date of birth in your profile to compare against your age group.
        </CardContent>
      </Card>
    );
  }

  const comparisons = [
    buildComparison(age, 'annualGrossIncome', annualGrossIncome),
    buildComparison(age, 'netWorth', netWorth),
  ].filter((item): item is BenchmarkComparison => item !== null);
  const overall = overallAgeBenchmarkScore(comparisons);

  return (
    <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4 text-emerald-600" /> Your Age Benchmark
            </CardTitle>
            <div className="mt-1 text-xs text-slate-500">Compared with national household/family medians at age {age}</div>
          </div>
          {overall !== null && (
            <div className="rounded-lg bg-slate-100 px-3 py-2 text-center dark:bg-slate-800">
              <div className="text-xl font-bold text-slate-900 dark:text-white">{overall}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Overall</div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {comparisons.length > 0 ? (
          comparisons.map((comparison) => (
            <MetricRow key={`${comparison.metric}-${comparison.ageBand.label}`} comparison={comparison} />
          ))
        ) : (
          <div className="text-sm text-slate-500">Add income and asset/debt data to calculate this comparison.</div>
        )}
        {stateCode && (
          <div className="flex gap-2 text-[11px] text-slate-500 bg-slate-50 dark:bg-slate-800/50 rounded-lg px-3 py-2">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Showing national comparison. State-specific comparison for {stateCode} coming soon.</span>
          </div>
        )}
        <div className="flex gap-2 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500 dark:border-slate-800">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{BENCHMARK_DISCLOSURE}</span>
        </div>
      </CardContent>
    </Card>
  );
}
