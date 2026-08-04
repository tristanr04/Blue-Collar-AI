import { describe, expect, it } from 'vitest';
import { AGE_BENCHMARKS } from '../age-benchmark-data';
import { compareToAgeMedian, findAgeBenchmark } from '../age-benchmarks';

describe('official age benchmark dataset', () => {
  it('uses the 2024 ACS household income median for users under 25', () => {
    const benchmark = findAgeBenchmark([...AGE_BENCHMARKS], 'annualGrossIncome', 22);
    expect(benchmark?.median).toBe(46_651);
    expect(benchmark?.source.publisher).toBe('U.S. Census Bureau');
    expect(benchmark?.source.year).toBe(2024);
  });

  it('uses the 2022 SCF family net worth median for users under 35', () => {
    const benchmark = findAgeBenchmark([...AGE_BENCHMARKS], 'netWorth', 22);
    expect(benchmark?.median).toBe(39_000);
    expect(benchmark?.source.publisher).toBe('Federal Reserve');
    expect(benchmark?.source.year).toBe(2022);
  });

  it('maps every supported adult age to exactly one income and net-worth band', () => {
    for (let age = 18; age <= 100; age += 1) {
      expect(findAgeBenchmark([...AGE_BENCHMARKS], 'annualGrossIncome', age)).not.toBeNull();
      expect(findAgeBenchmark([...AGE_BENCHMARKS], 'netWorth', age)).not.toBeNull();
    }
  });

  it('places an exact median at the neutral midpoint instead of calling it a percentile', () => {
    const benchmark = findAgeBenchmark([...AGE_BENCHMARKS], 'netWorth', 22);
    expect(benchmark).not.toBeNull();
    const comparison = compareToAgeMedian(39_000, benchmark!);
    expect(comparison?.score).toBe(50);
    expect(comparison?.standing).toBe('near-median');
  });
});
