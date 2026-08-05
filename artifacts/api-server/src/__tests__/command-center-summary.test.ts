import assert from "node:assert/strict";
import test from "node:test";
import { createCommandCenterSummary } from "../lib/command-center-summary.js";

test("does not present missing financial data as zero", () => {
  const summary = createCommandCenterSummary({});

  assert.equal(summary.netWorth.value, null);
  assert.equal(summary.netWorth.status, "missing");
  assert.equal(summary.monthlyCashFlow.value, null);
  assert.equal(summary.healthScore, null);
  assert.equal(summary.nextBestMove.category, "income");
  assert.ok(summary.missingData.includes("income"));
});

test("calculates confirmed totals and a positive monthly surplus", () => {
  const summary = createCommandCenterSummary({
    monthlyNetIncome: 8_000,
    monthlyBills: 3_000,
    monthlyDebtPayments: 1_000,
    cash: 20_000,
    investments: 30_000,
    retirement: 50_000,
    otherAssets: 200_000,
    totalDebt: 150_000,
    highInterestDebt: 0,
    creditUtilization: 8,
    employerMatchCaptured: true,
    latestTaxEstimate: {
      totalEstimatedTax: 24_000,
      refundOrAmountOwed: 2_100,
      effectiveTaxRate: 18.5,
      confidence: "high",
    },
  });

  assert.equal(summary.netWorth.value, 150_000);
  assert.equal(summary.monthlyCashFlow.value, 4_000);
  assert.equal(summary.emergencyFundMonths.value, 5);
  assert.equal(summary.investments.value, 80_000);
  assert.equal(summary.taxEstimate?.refundOrAmountOwed, 2_100);
  assert.equal(summary.nextBestMove.title, "Put this month’s surplus to work");
  assert.ok(summary.healthScore !== null && summary.healthScore > 0);
});

test("prioritizes a negative cash-flow gap before lower-priority actions", () => {
  const summary = createCommandCenterSummary({
    monthlyNetIncome: 4_000,
    monthlyBills: 3_500,
    monthlyDebtPayments: 1_000,
    cash: 10_000,
    totalDebt: 20_000,
    highInterestDebt: 5_000,
    creditUtilization: 75,
  });

  assert.equal(summary.monthlyCashFlow.value, -500);
  assert.equal(summary.nextBestMove.category, "cash-flow");
  assert.equal(summary.nextBestMove.estimatedImpact, 500);
});

test("prioritizes emergency savings when cash covers less than one month", () => {
  const summary = createCommandCenterSummary({
    monthlyNetIncome: 6_000,
    monthlyBills: 3_000,
    monthlyDebtPayments: 500,
    cash: 1_000,
    totalDebt: 20_000,
    highInterestDebt: 0,
    creditUtilization: 10,
  });

  assert.equal(summary.nextBestMove.category, "emergency-fund");
  assert.equal(summary.nextBestMove.estimatedImpact, 2_500);
});

test("prioritizes high-interest debt once the first cash buffer exists", () => {
  const summary = createCommandCenterSummary({
    monthlyNetIncome: 7_000,
    monthlyBills: 3_000,
    monthlyDebtPayments: 500,
    cash: 8_000,
    totalDebt: 25_000,
    highInterestDebt: 7_500,
    creditUtilization: 20,
  });

  assert.equal(summary.nextBestMove.category, "debt");
  assert.equal(summary.nextBestMove.estimatedImpact, 7_500);
});

test("asks for a saved tax estimate instead of inventing one", () => {
  const summary = createCommandCenterSummary({
    monthlyNetIncome: 7_000,
    monthlyBills: 2_000,
    monthlyDebtPayments: 500,
    cash: 20_000,
    investments: 10_000,
    totalDebt: 0,
    highInterestDebt: 0,
    creditUtilization: 5,
    employerMatchCaptured: true,
  });

  assert.equal(summary.taxEstimate, null);
  assert.equal(summary.nextBestMove.category, "tax");
});
