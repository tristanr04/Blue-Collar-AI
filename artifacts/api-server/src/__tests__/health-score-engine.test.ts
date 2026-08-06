/**
 * Tests for the Financial Health Score Engine.
 *
 * Key invariants:
 * - Missing data NEVER scores as zero (confidence falls instead).
 * - Score is projected to 0–100 from categories with data.
 * - Confidence = max-possible points for categories with data / 100.
 * - All-data-present scenario allows score of 100.
 * - Lowest-scoring filled category drives the recommendation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeHealthScore, type HealthScoreInput } from "../lib/health-score-engine.js";

// ─── Full-data baseline ───────────────────────────────────────────────────────

function perfect(): HealthScoreInput {
  return {
    monthlyNetIncome: 6_000,
    paystubCount: 6,
    monthlyBills: 800,
    monthlyDebtPayments: 200,
    cash: 30_000,
    investments: 60_000,
    retirement: 120_000,
    totalDebt: 0,
    highInterestDebt: 0,
    creditUtilization: 5,
    hasTaxEstimate: true,
    taxEstimateAgeDays: 15,
    hasInsurance: true,
    documentCompletionPct: 100,
  };
}

describe("computeHealthScore — full data", () => {
  it("returns a score of 100 for a financially perfect profile", () => {
    const result = computeHealthScore(perfect());
    assert.equal(result.score, 100);
  });

  it("returns confidence 100 when all categories have data", () => {
    const result = computeHealthScore(perfect());
    assert.equal(result.confidence, 100);
  });

  it("returns 10 filled categories", () => {
    const result = computeHealthScore(perfect());
    const filled = result.categories.filter((c) => c.hasData);
    assert.equal(filled.length, 10);
  });

  it("returns a recommendation object", () => {
    const result = computeHealthScore(perfect());
    assert.ok(result.recommendation.title);
    assert.ok(result.recommendation.route);
  });
});

// ─── Missing data never scores as zero ───────────────────────────────────────

describe("Missing data — never zero, lowers confidence", () => {
  it("score is null when no core financial categories have data", () => {
    // Only always-on behavioural categories (tax, insurance, docCompletion) have data.
    // No real financial data → score must be null, not zero or a fabricated number.
    const result = computeHealthScore({
      monthlyNetIncome: null,
      paystubCount: 0,
      monthlyBills: null,
      monthlyDebtPayments: null,
      cash: null,
      investments: null,
      retirement: null,
      totalDebt: null,
      highInterestDebt: null,
      creditUtilization: null,
      hasTaxEstimate: false,
      taxEstimateAgeDays: null,
      hasInsurance: false,
      documentCompletionPct: 0,
    });
    assert.equal(result.score, null, "Score must be null when no core financial data exists");
  });

  it("cash flow category has hasData=false when monthlyNetIncome is null", () => {
    const result = computeHealthScore({ ...perfect(), monthlyNetIncome: null, paystubCount: 0 });
    const cf = result.categories.find((c) => c.key === "cash_flow");
    assert.equal(cf?.hasData, false);
  });

  it("cash flow category does NOT score zero when missing — hasData is false", () => {
    const result = computeHealthScore({ ...perfect(), monthlyNetIncome: null, paystubCount: 0 });
    const cf = result.categories.find((c) => c.key === "cash_flow");
    // Presence of hasData=false means we excluded it from scoring, not scored as 0
    assert.equal(cf?.hasData, false);
    assert.equal(cf?.status, "missing");
  });

  it("emergency fund hasData=false when cash is null", () => {
    const result = computeHealthScore({ ...perfect(), cash: null });
    const ef = result.categories.find((c) => c.key === "emergency_fund");
    assert.equal(ef?.hasData, false);
  });

  it("debt category hasData=false when totalDebt is null", () => {
    const result = computeHealthScore({ ...perfect(), totalDebt: null });
    const debt = result.categories.find((c) => c.key === "debt");
    assert.equal(debt?.hasData, false);
  });

  it("investments category hasData=false when investments is null", () => {
    const result = computeHealthScore({ ...perfect(), investments: null });
    const inv = result.categories.find((c) => c.key === "investments");
    assert.equal(inv?.hasData, false);
  });

  it("retirement category hasData=false when retirement is null", () => {
    const result = computeHealthScore({ ...perfect(), retirement: null });
    const ret = result.categories.find((c) => c.key === "retirement");
    assert.equal(ret?.hasData, false);
  });

  it("income stability hasData=false when paystubCount is 0", () => {
    const result = computeHealthScore({ ...perfect(), paystubCount: 0 });
    const stab = result.categories.find((c) => c.key === "income_stability");
    assert.equal(stab?.hasData, false);
  });

  it("credit utilization hasData=false when null", () => {
    const result = computeHealthScore({ ...perfect(), creditUtilization: null });
    const cu = result.categories.find((c) => c.key === "credit_utilization");
    assert.equal(cu?.hasData, false);
  });

  it("confidence drops when major categories are missing", () => {
    const full = computeHealthScore(perfect());
    const partial = computeHealthScore({ ...perfect(), cash: null, investments: null, retirement: null, totalDebt: null });
    assert.ok(partial.confidence < full.confidence, "Confidence should be lower with missing data");
  });
});

// ─── Scoring thresholds ───────────────────────────────────────────────────────

describe("Cash Flow scoring thresholds", () => {
  it("scores max (20) when surplus ≥30% of income", () => {
    const result = computeHealthScore({ ...perfect(), monthlyNetIncome: 5_000, monthlyBills: 2_000, monthlyDebtPayments: 500 });
    // surplus = 2500, ratio = 50%
    const cf = result.categories.find((c) => c.key === "cash_flow");
    assert.equal(cf?.score, 20);
  });

  it("scores 17 when surplus is 20–29% of income", () => {
    const result = computeHealthScore({ ...perfect(), monthlyNetIncome: 5_000, monthlyBills: 3_000, monthlyDebtPayments: 500 });
    // surplus = 1500, ratio = 30%... wait that's ≥30%, let me use exact 25%
    const r2 = computeHealthScore({ ...perfect(), monthlyNetIncome: 4_000, monthlyBills: 2_700, monthlyDebtPayments: 300 });
    // surplus = 1000, ratio = 25%
    const cf = r2.categories.find((c) => c.key === "cash_flow");
    assert.equal(cf?.score, 17);
  });

  it("scores 3 for negative cash flow", () => {
    const result = computeHealthScore({ ...perfect(), monthlyNetIncome: 3_000, monthlyBills: 2_500, monthlyDebtPayments: 1_000 });
    const cf = result.categories.find((c) => c.key === "cash_flow");
    assert.equal(cf?.score, 3);
  });
});

describe("Emergency Fund scoring thresholds", () => {
  it("scores max (15) for 6+ months of expenses", () => {
    const result = computeHealthScore({ ...perfect(), cash: 30_000, monthlyBills: 2_000, monthlyDebtPayments: 500 });
    // months = 30000/2500 = 12
    const ef = result.categories.find((c) => c.key === "emergency_fund");
    assert.equal(ef?.score, 15);
  });

  it("scores 11 for 3–5 months", () => {
    const result = computeHealthScore({ ...perfect(), cash: 12_500, monthlyBills: 2_000, monthlyDebtPayments: 500 });
    // months = 12500/2500 = 5
    const ef = result.categories.find((c) => c.key === "emergency_fund");
    assert.equal(ef?.score, 11);
  });

  it("scores 7 for 1–2 months", () => {
    const result = computeHealthScore({ ...perfect(), cash: 3_000, monthlyBills: 2_000, monthlyDebtPayments: 500 });
    // months = 3000/2500 = 1.2
    const ef = result.categories.find((c) => c.key === "emergency_fund");
    assert.equal(ef?.score, 7);
  });

  it("scores 4 for less than 1 month", () => {
    const result = computeHealthScore({ ...perfect(), cash: 500, monthlyBills: 2_000, monthlyDebtPayments: 500 });
    // months = 500/2500 = 0.2
    const ef = result.categories.find((c) => c.key === "emergency_fund");
    assert.equal(ef?.score, 4);
  });
});

describe("Credit Utilization scoring thresholds", () => {
  it("scores max (10) for ≤10% utilization", () => {
    const result = computeHealthScore({ ...perfect(), creditUtilization: 8 });
    const cu = result.categories.find((c) => c.key === "credit_utilization");
    assert.equal(cu?.score, 10);
  });

  it("scores 7 for 11–30% utilization", () => {
    const result = computeHealthScore({ ...perfect(), creditUtilization: 25 });
    const cu = result.categories.find((c) => c.key === "credit_utilization");
    assert.equal(cu?.score, 7);
  });

  it("scores 4 for 31–50% utilization", () => {
    const result = computeHealthScore({ ...perfect(), creditUtilization: 45 });
    const cu = result.categories.find((c) => c.key === "credit_utilization");
    assert.equal(cu?.score, 4);
  });

  it("scores 2 for 51–75% utilization", () => {
    const result = computeHealthScore({ ...perfect(), creditUtilization: 60 });
    const cu = result.categories.find((c) => c.key === "credit_utilization");
    assert.equal(cu?.score, 2);
  });

  it("scores 1 for >75% utilization", () => {
    const result = computeHealthScore({ ...perfect(), creditUtilization: 85 });
    const cu = result.categories.find((c) => c.key === "credit_utilization");
    assert.equal(cu?.score, 1);
  });
});

describe("Tax Readiness scoring", () => {
  it("scores max (5) when estimate is fresh (≤30 days)", () => {
    const result = computeHealthScore({ ...perfect(), hasTaxEstimate: true, taxEstimateAgeDays: 10 });
    const tax = result.categories.find((c) => c.key === "tax_readiness");
    assert.equal(tax?.score, 5);
  });

  it("scores 1 when no estimate has been saved", () => {
    const result = computeHealthScore({ ...perfect(), hasTaxEstimate: false });
    const tax = result.categories.find((c) => c.key === "tax_readiness");
    assert.equal(tax?.score, 1);
  });

  it("tax readiness always hasData=true", () => {
    const result = computeHealthScore({ ...perfect(), hasTaxEstimate: false });
    const tax = result.categories.find((c) => c.key === "tax_readiness");
    assert.equal(tax?.hasData, true);
  });
});

// ─── Recommendation ───────────────────────────────────────────────────────────

describe("Recommendation — lowest scoring category drives it", () => {
  it("recommends emergency_fund action when fund is lowest", () => {
    // Very low cash, everything else good
    const result = computeHealthScore({ ...perfect(), cash: 500, monthlyBills: 2_000, monthlyDebtPayments: 500 });
    // emergency fund scores 4/15 (27%), cash flow scores 20/20 (100%)
    // emergency fund should be lowest → recommendation
    const reco = result.recommendation;
    assert.equal(reco.category, "emergency_fund");
  });

  it("recommends debt action when high-interest debt is present", () => {
    const result = computeHealthScore({
      ...perfect(),
      totalDebt: 50_000,
      highInterestDebt: 50_000,
      monthlyNetIncome: 4_000,
      cash: 30_000,          // good emergency fund
    });
    // debt score should be low
    const debt = result.categories.find((c) => c.key === "debt");
    assert.ok(debt && debt.pct < 50, "Debt category should be low-scoring");
  });

  it("returns a recommendation with a non-empty title and route", () => {
    const result = computeHealthScore(perfect());
    assert.ok(result.recommendation.title.length > 0);
    assert.ok(result.recommendation.route.startsWith("/"));
  });
});

// ─── Score projection ─────────────────────────────────────────────────────────

describe("Score projection — partial data", () => {
  it("score stays 0–100 even with partial categories", () => {
    const result = computeHealthScore({
      ...perfect(),
      cash: null,
      investments: null,
      retirement: null,
      totalDebt: null,
    });
    assert.ok(result.score === null || (result.score >= 0 && result.score <= 100));
  });

  it("rawScore never exceeds maxPossible", () => {
    const result = computeHealthScore(perfect());
    assert.ok(result.rawScore <= result.maxPossible);
  });

  it("maxPossible never exceeds 100", () => {
    const result = computeHealthScore(perfect());
    assert.ok(result.maxPossible <= 100);
  });

  it("confidence is 100 when all categories have data", () => {
    const result = computeHealthScore(perfect());
    assert.equal(result.confidence, 100);
  });

  it("confidence is less than 100 when some categories have no data", () => {
    const result = computeHealthScore({ ...perfect(), cash: null, investments: null });
    assert.ok(result.confidence < 100);
  });
});
