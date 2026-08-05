import type { AgeBenchmark, AgeBand, BenchmarkSource } from './age-benchmarks';

const SCF_2022: BenchmarkSource = {
  publisher: 'Federal Reserve',
  dataset: '2022 Survey of Consumer Finances, Table 2',
  year: 2022,
  urlLabel: 'Federal Reserve SCF 2022',
};

const ACS_2024: BenchmarkSource = {
  publisher: 'U.S. Census Bureau',
  dataset: '2024 ACS 1-Year Estimates, Table B19049',
  year: 2024,
  urlLabel: 'Census ACS B19049 (2024)',
};

export const SCF_AGE_BANDS: readonly AgeBand[] = [
  { minAge: 18, maxAge: 34, label: 'Under 35' },
  { minAge: 35, maxAge: 44, label: '35–44' },
  { minAge: 45, maxAge: 54, label: '45–54' },
  { minAge: 55, maxAge: 64, label: '55–64' },
  { minAge: 65, maxAge: 74, label: '65–74' },
  { minAge: 75, maxAge: null, label: '75+' },
] as const;

export const ACS_INCOME_AGE_BANDS: readonly AgeBand[] = [
  { minAge: 18, maxAge: 24, label: 'Under 25' },
  { minAge: 25, maxAge: 44, label: '25–44' },
  { minAge: 45, maxAge: 64, label: '45–64' },
  { minAge: 65, maxAge: null, label: '65+' },
] as const;

/**
 * Public, national age benchmarks used by the comparison card.
 *
 * Important: these are household/family medians, not individual percentiles.
 * SCF dollar values are published in thousands of 2022 dollars and converted
 * here to dollars. ACS income is 2024 inflation-adjusted household income.
 */
export const AGE_BENCHMARKS: readonly AgeBenchmark[] = [
  // Median household income by age of householder — ACS B19049, 2024.
  { metric: 'annualGrossIncome', ageBand: ACS_INCOME_AGE_BANDS[0], median: 46_651, source: ACS_2024 },
  { metric: 'annualGrossIncome', ageBand: ACS_INCOME_AGE_BANDS[1], median: 92_084, source: ACS_2024 },
  { metric: 'annualGrossIncome', ageBand: ACS_INCOME_AGE_BANDS[2], median: 100_055, source: ACS_2024 },
  { metric: 'annualGrossIncome', ageBand: ACS_INCOME_AGE_BANDS[3], median: 59_648, source: ACS_2024 },

  // Median family net worth by age of reference person — SCF Table 2, 2022.
  { metric: 'netWorth', ageBand: SCF_AGE_BANDS[0], median: 39_000, source: SCF_2022 },
  { metric: 'netWorth', ageBand: SCF_AGE_BANDS[1], median: 135_600, source: SCF_2022 },
  { metric: 'netWorth', ageBand: SCF_AGE_BANDS[2], median: 247_200, source: SCF_2022 },
  { metric: 'netWorth', ageBand: SCF_AGE_BANDS[3], median: 364_500, source: SCF_2022 },
  { metric: 'netWorth', ageBand: SCF_AGE_BANDS[4], median: 409_900, source: SCF_2022 },
  { metric: 'netWorth', ageBand: SCF_AGE_BANDS[5], median: 335_600, source: SCF_2022 },
];

export const BENCHMARK_DISCLOSURE =
  'National household/family medians are context, not a financial grade or true percentile. Household size, location, homeownership, education, and career stage can materially change a fair comparison.';
