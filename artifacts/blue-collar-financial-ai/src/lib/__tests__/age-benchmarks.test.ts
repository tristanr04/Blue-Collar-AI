import { describe, expect, it } from 'vitest';
import {
  ageFromBirthDate,
  compareToAgeMedian,
  findAgeBenchmark,
  overallAgeBenchmarkScore,
  type AgeBenchmark,
} from '../age-benchmarks';

const benchmark: AgeBenchmark = {
  metric: 'netWorth',
  ageBand: { minAge: 18, maxAge: 24, label: '18–24' },
  median: 10_000,
  source: {
    publisher: 'Federal Reserve',
    dataset: 'Survey of Consumer Finances',
    year: 2022,
    urlLabel: 'SCF 2022',
  },
};

describe('age-benchmarks', () => {
  it('calculates age without rounding up before the birthday', () => {
    expect(ageFromBirthDate('2004-03-15', new Date('2026-03-14T12:00:00Z'))).toBe(21);
    expect(ageFromBirthDate('2004-03-15', new Date('2026-03-15T12:00:00Z'))).toBe(22);
  });

  it('rejects invalid and future birth dates', () => {
    expect(ageFromBirthDate('not-a-date')).toBeNull();
    expect(ageFromBirthDate('2099-01-01', new Date('2026-01-01T00:00:00Z'))).toBeNull();
  });

  it('selects the matching metric and age band', () => {
    expect(findAgeBenchmark([benchmark], 'netWorth', 22)).toBe(benchmark);
    expect(findAgeBenchmark([benchmark], 'netWorth', 25)).toBeNull();
    expect(findAgeBenchmark([benchmark], 'annualGrossIncome', 22)).toBeNull();
  });

  it('scores the published median at 50 without pretending it is a percentile', () => {
    const comparison = compareToAgeMedian(10_000, benchmark);
    expect(comparison?.score).toBe(50);
    expect(comparison?.standing).toBe('near-median');
    expect(comparison?.ratioToMedian).toBe(1);
  });

  it('scores higher positive-value metrics ahead of the median', () => {
    const comparison = compareToAgeMedian(20_000, benchmark);
    expect(comparison?.score).toBe(90);
    expect(comparison?.standing).toBe('far-ahead');
  });

  it('reverses the comparison for lower-is-better metrics', () => {
    const dtiBenchmark: AgeBenchmark = {
      ...benchmark,
      metric: 'debtToIncome',
      median: 30,
      lowerIsBetter: true,
    };

    expect((compareToAgeMedian(15, dtiBenchmark)?.score ?? 0) > 50).toBe(true);
    expect((compareToAgeMedian(60, dtiBenchmark)?.score ?? 100) < 50).toBe(true);
  });

  it('overall score ignores unavailable comparisons', () => {
    const comparison = compareToAgeMedian(10_000, benchmark);
    expect(overallAgeBenchmarkScore([comparison, null])).toBe(50);
    expect(overallAgeBenchmarkScore([null])).toBeNull();
  });
});
