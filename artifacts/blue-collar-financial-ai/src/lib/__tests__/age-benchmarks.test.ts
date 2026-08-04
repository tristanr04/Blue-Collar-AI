import assert from "node:assert/strict";
import test from "node:test";
import {
  ageFromBirthDate,
  compareToAgeMedian,
  findAgeBenchmark,
  overallAgeBenchmarkScore,
  type AgeBenchmark,
} from "../age-benchmarks";

const benchmark: AgeBenchmark = {
  metric: "netWorth",
  ageBand: { minAge: 18, maxAge: 24, label: "18–24" },
  median: 10_000,
  source: {
    publisher: "Federal Reserve",
    dataset: "Survey of Consumer Finances",
    year: 2022,
    urlLabel: "SCF 2022",
  },
};

test("calculates age without rounding up before the birthday", () => {
  assert.equal(ageFromBirthDate("2004-03-15", new Date("2026-03-14T12:00:00Z")), 21);
  assert.equal(ageFromBirthDate("2004-03-15", new Date("2026-03-15T12:00:00Z")), 22);
});

test("rejects invalid and future birth dates", () => {
  assert.equal(ageFromBirthDate("not-a-date"), null);
  assert.equal(ageFromBirthDate("2099-01-01", new Date("2026-01-01T00:00:00Z")), null);
});

test("selects the matching metric and age band", () => {
  assert.equal(findAgeBenchmark([benchmark], "netWorth", 22), benchmark);
  assert.equal(findAgeBenchmark([benchmark], "netWorth", 25), null);
  assert.equal(findAgeBenchmark([benchmark], "annualGrossIncome", 22), null);
});

test("scores the published median at 50 without pretending it is a percentile", () => {
  const comparison = compareToAgeMedian(10_000, benchmark);
  assert.equal(comparison?.score, 50);
  assert.equal(comparison?.standing, "near-median");
  assert.equal(comparison?.ratioToMedian, 1);
});

test("scores higher positive-value metrics ahead of the median", () => {
  const comparison = compareToAgeMedian(20_000, benchmark);
  assert.equal(comparison?.score, 90);
  assert.equal(comparison?.standing, "far-ahead");
});

test("reverses the comparison for lower-is-better metrics", () => {
  const dtiBenchmark: AgeBenchmark = {
    ...benchmark,
    metric: "debtToIncome",
    median: 30,
    lowerIsBetter: true,
  };

  assert.ok((compareToAgeMedian(15, dtiBenchmark)?.score ?? 0) > 50);
  assert.ok((compareToAgeMedian(60, dtiBenchmark)?.score ?? 100) < 50);
});

test("overall score ignores unavailable comparisons", () => {
  const comparison = compareToAgeMedian(10_000, benchmark);
  assert.equal(overallAgeBenchmarkScore([comparison, null]), 50);
  assert.equal(overallAgeBenchmarkScore([null]), null);
});
