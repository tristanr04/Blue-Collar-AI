export type BenchmarkMetric =
  | "annualGrossIncome"
  | "netWorth"
  | "liquidSavings"
  | "investmentAssets"
  | "debtToIncome"
  | "emergencyFundMonths";

export interface AgeBand {
  minAge: number;
  maxAge: number | null;
  label: string;
}

export interface BenchmarkSource {
  publisher: "U.S. Census Bureau" | "Federal Reserve" | "Bureau of Labor Statistics";
  dataset: string;
  year: number;
  urlLabel: string;
}

export interface AgeBenchmark {
  metric: BenchmarkMetric;
  ageBand: AgeBand;
  median: number;
  lowerIsBetter?: boolean;
  source: BenchmarkSource;
}

export type BenchmarkStanding =
  | "far-behind"
  | "behind"
  | "near-median"
  | "ahead"
  | "far-ahead";

export interface BenchmarkComparison {
  metric: BenchmarkMetric;
  ageBand: AgeBand;
  userValue: number;
  benchmarkMedian: number;
  difference: number;
  percentDifference: number | null;
  ratioToMedian: number | null;
  score: number;
  standing: BenchmarkStanding;
  source: BenchmarkSource;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function ageFromBirthDate(birthDate: string, asOf = new Date()): number | null {
  const parsed = new Date(`${birthDate}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed > asOf) return null;

  let age = asOf.getUTCFullYear() - parsed.getUTCFullYear();
  const monthDifference = asOf.getUTCMonth() - parsed.getUTCMonth();
  if (monthDifference < 0 || (monthDifference === 0 && asOf.getUTCDate() < parsed.getUTCDate())) {
    age -= 1;
  }

  return age >= 0 && age <= 120 ? age : null;
}

export function findAgeBenchmark(
  benchmarks: AgeBenchmark[],
  metric: BenchmarkMetric,
  age: number,
): AgeBenchmark | null {
  return (
    benchmarks.find(
      (benchmark) =>
        benchmark.metric === metric &&
        age >= benchmark.ageBand.minAge &&
        (benchmark.ageBand.maxAge === null || age <= benchmark.ageBand.maxAge),
    ) ?? null
  );
}

/**
 * Converts the user's ratio to the published median into a bounded 0-100 scale.
 * 50 means approximately at the median. The score is intentionally not described
 * as a percentile because median-only public tables cannot support a true percentile.
 */
export function compareToAgeMedian(
  userValue: number,
  benchmark: AgeBenchmark,
): BenchmarkComparison | null {
  if (!Number.isFinite(userValue) || !Number.isFinite(benchmark.median)) return null;

  const median = benchmark.median;
  const lowerIsBetter = benchmark.lowerIsBetter === true;
  const difference = userValue - median;

  let ratioToMedian: number | null = null;
  let percentDifference: number | null = null;
  let performanceRatio = 1;

  if (median !== 0) {
    ratioToMedian = userValue / median;
    percentDifference = (difference / Math.abs(median)) * 100;
    performanceRatio = lowerIsBetter
      ? userValue <= 0
        ? 2
        : median / userValue
      : userValue / median;
  } else if (lowerIsBetter) {
    performanceRatio = userValue <= 0 ? 2 : 0;
  } else {
    performanceRatio = userValue > 0 ? 2 : 1;
  }

  const score = Math.round(clamp(50 + 40 * Math.log2(Math.max(performanceRatio, 0.125)), 0, 100));

  const standing: BenchmarkStanding =
    score < 25
      ? "far-behind"
      : score < 45
        ? "behind"
        : score <= 55
          ? "near-median"
          : score <= 75
            ? "ahead"
            : "far-ahead";

  return {
    metric: benchmark.metric,
    ageBand: benchmark.ageBand,
    userValue,
    benchmarkMedian: median,
    difference,
    percentDifference,
    ratioToMedian,
    score,
    standing,
    source: benchmark.source,
  };
}

export function overallAgeBenchmarkScore(
  comparisons: Array<BenchmarkComparison | null>,
): number | null {
  const valid = comparisons.filter((comparison): comparison is BenchmarkComparison => comparison !== null);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((sum, comparison) => sum + comparison.score, 0) / valid.length);
}
