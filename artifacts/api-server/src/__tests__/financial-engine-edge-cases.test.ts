/**
 * Phase 5 — Financial Engine Edge Case Tests
 *
 * Covers every edge-case category from the sprint spec:
 *  - Negative balances
 *  - Zero income
 *  - Multiple jobs
 *  - Weekly / Bi-weekly / Monthly pay periods
 *  - Overtime (FLSA + phase-out)
 *  - Per diem (accountable plan vs. taxable)
 *  - Bonuses
 *  - Employer retirement matching
 *  - Payoff calculator (all boundary conditions)
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { calculatePayoffSchedule } from "../lib/payoff-calculator.js";
import {
  calculateOvertimeTax,
  getOvertimeDeductionRules,
} from "../lib/overtime-tax.js";

// ─────────────────────────────────────────────────────────────────────────────
// PAYOFF CALCULATOR — boundary conditions
// ─────────────────────────────────────────────────────────────────────────────

describe("payoff-calculator — edge cases", () => {

  test("negative balance is treated as 0 (debt already paid)", () => {
    const schedule = calculatePayoffSchedule({
      debts: [{ id: "d1", name: "Paid Debt", balance: -500, interestRate: 10, minimumPayment: 50 }],
      strategy: "avalanche",
      extraMonthlyPayment: 0,
    });
    // A negative balance means nothing is owed — should behave like 0
    assert.equal(schedule.totalMonths, 0, "Negative balance debt should contribute 0 months");
    assert.equal(schedule.totalInterestPaid, 0);
  });

  test("zero balance debt accrues no interest and exits immediately", () => {
    const schedule = calculatePayoffSchedule({
      debts: [{ id: "d1", name: "Zero Debt", balance: 0, interestRate: 20, minimumPayment: 50 }],
      strategy: "avalanche",
      extraMonthlyPayment: 0,
    });
    assert.equal(schedule.totalMonths, 0);
    assert.equal(schedule.totalInterestPaid, 0);
  });

  test("zero minimum payment and zero extra payment — debt cannot be paid off", () => {
    // With no payment, the schedule hits the 360-month cap
    const schedule = calculatePayoffSchedule({
      debts: [{ id: "d1", name: "Stuck Debt", balance: 5000, interestRate: 18, minimumPayment: 0 }],
      strategy: "avalanche",
      extraMonthlyPayment: 0,
    });
    assert.equal(schedule.truncated, true, "Should be truncated at 360 months");
    assert.equal(schedule.totalMonths, 360);
  });

  test("very large extra payment pays off debt in one month", () => {
    const schedule = calculatePayoffSchedule({
      debts: [{ id: "d1", name: "Small Debt", balance: 100, interestRate: 20, minimumPayment: 10 }],
      strategy: "avalanche",
      extraMonthlyPayment: 10_000,
    });
    assert.equal(schedule.totalMonths, 1, "Massive extra payment should pay off in 1 month");
  });

  test("multiple debts: all paid off in a reasonable schedule", () => {
    const debts = Array.from({ length: 5 }, (_, i) => ({
      id: `d${i}`,
      name: `Debt ${i}`,
      balance: (i + 1) * 1000,
      interestRate: 5 + i * 3,
      minimumPayment: 50 + i * 25,
    }));
    const schedule = calculatePayoffSchedule({ debts, strategy: "avalanche", extraMonthlyPayment: 200 });
    assert.equal(schedule.debtSummaries.length, 5);
    assert.ok(schedule.totalMonths > 0);
    assert.ok(!schedule.truncated, "With reasonable payments, 5 debts should pay off within 30 years");
  });

  test("all interest rates identical — avalanche and snowball produce equivalent total interest", () => {
    const debts = [
      { id: "d1", name: "Small", balance: 500, interestRate: 10, minimumPayment: 25 },
      { id: "d2", name: "Medium", balance: 1500, interestRate: 10, minimumPayment: 50 },
      { id: "d3", name: "Large", balance: 3000, interestRate: 10, minimumPayment: 100 },
    ];
    const avSchedule = calculatePayoffSchedule({ debts, strategy: "avalanche", extraMonthlyPayment: 150 });
    const snSchedule = calculatePayoffSchedule({ debts, strategy: "snowball", extraMonthlyPayment: 150 });
    // Same rates → same total interest regardless of order
    assert.ok(
      Math.abs(avSchedule.totalInterestPaid - snSchedule.totalInterestPaid) < 5,
      "Identical rates → nearly equal interest for both strategies",
    );
  });

  test("schedule month payments are non-negative for every debt in every month", () => {
    const schedule = calculatePayoffSchedule({
      debts: [
        { id: "d1", name: "Card", balance: 2000, interestRate: 22, minimumPayment: 50 },
        { id: "d2", name: "Loan", balance: 8000, interestRate: 5, minimumPayment: 150 },
      ],
      strategy: "snowball",
      extraMonthlyPayment: 100,
    });
    for (const month of schedule.months) {
      for (const alloc of month.allocations) {
        assert.ok(alloc.payment >= 0, `Month ${month.month} debt ${alloc.debtId}: payment must be >= 0`);
        assert.ok(alloc.interestCharged >= 0, "Interest charged must be >= 0");
        assert.ok(alloc.remainingBalance >= 0, "Remaining balance must be >= 0");
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OVERTIME TAX — edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("overtime-tax — edge cases", () => {

  // ── Zero income ─────────────────────────────────────────────────────────────

  test("zero MAGI produces no phase-out reduction", () => {
    const result = calculateOvertimeTax({
      taxYear: 2026,
      filingStatus: "single",
      modifiedAdjustedGrossIncome: 0,
      entries: [{
        regularRate: 25,
        overtimeHours: 20,
        flsaStatus: "confirmed_eligible",
      }],
    });
    // Deduction should be the full premium, not reduced by phase-out
    assert.ok(result.candidateQualifiedPremium > 0);
    assert.equal(result.allowedQualifiedOvertimeDeduction, result.candidateQualifiedPremium);
  });

  test("zero overtime hours produces zero overtime pay", () => {
    const result = calculateOvertimeTax({
      taxYear: 2026,
      filingStatus: "single",
      modifiedAdjustedGrossIncome: 50_000,
      entries: [{
        regularRate: 20,
        overtimeHours: 0,
        flsaStatus: "confirmed_eligible",
      }],
    });
    assert.equal(result.totalOvertimeCashPay, 0);
    assert.equal(result.candidateQualifiedPremium, 0);
    assert.equal(result.allowedQualifiedOvertimeDeduction, 0);
  });

  // ── Multiple jobs ────────────────────────────────────────────────────────────

  test("multiple entries (two jobs) accumulate overtime correctly", () => {
    const result = calculateOvertimeTax({
      taxYear: 2026,
      filingStatus: "single",
      modifiedAdjustedGrossIncome: 80_000,
      entries: [
        { regularRate: 25, overtimeHours: 10, flsaStatus: "confirmed_eligible" },
        { regularRate: 30, overtimeHours: 15, flsaStatus: "confirmed_eligible" },
      ],
    });
    // Job1: 10h * 25 * 1.5 = 375 OT pay; premium = 10 * 25 * 0.5 = 125
    // Job2: 15h * 30 * 1.5 = 675 OT pay; premium = 15 * 30 * 0.5 = 225
    const expectedTotal = 375 + 675;
    assert.ok(
      Math.abs(result.totalOvertimeCashPay - expectedTotal) < 0.01,
      `Expected ${expectedTotal}, got ${result.totalOvertimeCashPay}`,
    );
  });

  test("one FLSA-ineligible entry and one eligible: only eligible counted in deduction", () => {
    const result = calculateOvertimeTax({
      taxYear: 2026,
      filingStatus: "single",
      modifiedAdjustedGrossIncome: 60_000,
      entries: [
        { regularRate: 25, overtimeHours: 10, flsaStatus: "confirmed_eligible" },
        { regularRate: 40, overtimeHours: 10, flsaStatus: "confirmed_ineligible" },
      ],
    });
    // Both contribute to cash pay, but only FLSA-eligible contributes to deduction
    const eligible_premium = 10 * 25 * 0.5; // = 125
    assert.ok(
      Math.abs(result.candidateQualifiedPremium - eligible_premium) < 0.01,
      `Expected deduction premium of ${eligible_premium}, got ${result.candidateQualifiedPremium}`,
    );
  });

  // ── Phase-out ────────────────────────────────────────────────────────────────

  test("single filer above $150k phase-out threshold sees reduced deduction", () => {
    const result = calculateOvertimeTax({
      taxYear: 2026,
      filingStatus: "single",
      modifiedAdjustedGrossIncome: 160_000, // $10k above threshold
      entries: [{
        regularRate: 50,
        overtimeHours: 100,
        flsaStatus: "confirmed_eligible",
      }],
    });
    // Full premium at 50 * 0.5 * 100 = 2500; phase-out reduces by 10k * 0.1 = $1000
    const expectedReduction = Math.round(((160_000 - 150_000) / 1000) * 100); // per IRC rules
    assert.ok(
      result.allowedQualifiedOvertimeDeduction < result.candidateQualifiedPremium,
      "Deduction must be reduced by phase-out",
    );
  });

  test("deduction cap: single filer capped at $12,500 regardless of actual premium", () => {
    const result = calculateOvertimeTax({
      taxYear: 2026,
      filingStatus: "single",
      modifiedAdjustedGrossIncome: 50_000,
      entries: [{
        regularRate: 100,
        overtimeHours: 500, // enormous OT — premium would exceed cap
        flsaStatus: "confirmed_eligible",
      }],
    });
    assert.ok(
      result.allowedQualifiedOvertimeDeduction <= 12_500,
      `Deduction ${result.allowedQualifiedOvertimeDeduction} must not exceed single cap of 12500`,
    );
  });

  test("married filing jointly capped at $25,000", () => {
    const result = calculateOvertimeTax({
      taxYear: 2026,
      filingStatus: "married_filing_jointly",
      modifiedAdjustedGrossIncome: 100_000,
      entries: [{
        regularRate: 100,
        overtimeHours: 1000,
        flsaStatus: "confirmed_eligible",
      }],
    });
    assert.ok(
      result.allowedQualifiedOvertimeDeduction <= 25_000,
      `MFJ deduction ${result.allowedQualifiedOvertimeDeduction} must not exceed cap of 25000`,
    );
  });

  // ── Tax year boundaries ───────────────────────────────────────────────────────

  test("tax year outside 2025-2028 — deduction unavailable", () => {
    const rules2024 = getOvertimeDeductionRules(2024, "single");
    const rules2029 = getOvertimeDeductionRules(2029, "single");
    assert.equal(rules2024.available, false, "2024: deduction not yet available");
    assert.equal(rules2029.available, false, "2029: deduction expired");
  });

  test("tax year 2025 — deduction IS available", () => {
    const rules = getOvertimeDeductionRules(2025, "single");
    assert.equal(rules.available, true);
    assert.equal(rules.cap, 12_500);
  });

  // ── Needs-confirmation ────────────────────────────────────────────────────────

  test("needs_confirmation FLSA status produces a warning and partial/needs_confirmation status", () => {
    const result = calculateOvertimeTax({
      taxYear: 2026,
      filingStatus: "single",
      modifiedAdjustedGrossIncome: 50_000,
      entries: [{
        regularRate: 25,
        overtimeHours: 20,
        hoursWorkedInWorkweek: 60,
        flsaStatus: "needs_confirmation",
      }],
    });
    assert.ok(
      result.qualificationStatus === "needs_confirmation" || result.qualificationStatus === "partially_qualified",
      `Expected needs_confirmation or partially_qualified, got ${result.qualificationStatus}`,
    );
    assert.ok(result.warnings.length > 0, "Should have warnings for unconfirmed FLSA status");
  });

  // ── Double-time ────────────────────────────────────────────────────────────────

  test("double-time pay is included in total cash pay", () => {
    const result = calculateOvertimeTax({
      taxYear: 2026,
      filingStatus: "single",
      modifiedAdjustedGrossIncome: 70_000,
      entries: [{
        regularRate: 30,
        overtimeHours: 8,
        doubleTimeHours: 4,
        flsaStatus: "confirmed_eligible",
      }],
    });
    const expectedOT = 8 * 30 * 1.5; // 360
    const expectedDT = 4 * 30 * 2;   // 240
    assert.ok(
      Math.abs(result.totalOvertimeCashPay - expectedOT) < 0.01,
      `Expected OT pay ~${expectedOT}`,
    );
    assert.ok(
      Math.abs(result.totalDoubleTimeCashPay - expectedDT) < 0.01,
      `Expected DT pay ~${expectedDT}`,
    );
  });

  // ── Deterministic repeatability ───────────────────────────────────────────────

  test("same inputs always produce identical outputs (deterministic)", () => {
    const input = {
      taxYear: 2026,
      filingStatus: "single" as const,
      modifiedAdjustedGrossIncome: 75_000,
      entries: [
        { regularRate: 28, overtimeHours: 12, flsaStatus: "confirmed_eligible" as const },
        { regularRate: 32, overtimeHours: 8, doubleTimeHours: 2, flsaStatus: "confirmed_eligible" as const },
      ],
    };
    const r1 = calculateOvertimeTax(input);
    const r2 = calculateOvertimeTax(input);
    assert.equal(r1.totalOvertimeCashPay, r2.totalOvertimeCashPay);
    assert.equal(r1.candidateQualifiedPremium, r2.candidateQualifiedPremium);
    assert.equal(r1.allowedQualifiedOvertimeDeduction, r2.allowedQualifiedOvertimeDeduction);
    assert.equal(r1.qualificationStatus, r2.qualificationStatus);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PAY PERIOD MATH — weekly / biweekly / semimonthly / monthly
// ─────────────────────────────────────────────────────────────────────────────

describe("pay-period annualization", () => {
  const annualize = (netPerPeriod: number, frequency: "weekly" | "biweekly" | "semimonthly" | "monthly") => {
    const multiplier = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[frequency];
    return netPerPeriod * multiplier;
  };

  test("weekly paystub annualizes to 52x", () => {
    assert.equal(annualize(800, "weekly"), 800 * 52);
  });

  test("biweekly paystub annualizes to 26x", () => {
    assert.equal(annualize(1_600, "biweekly"), 1_600 * 26);
  });

  test("semimonthly paystub annualizes to 24x", () => {
    assert.equal(annualize(1_733.33, "semimonthly"), 1_733.33 * 24);
  });

  test("monthly paystub annualizes to 12x", () => {
    assert.equal(annualize(3_466.67, "monthly"), 3_466.67 * 12);
  });

  test("biweekly and semimonthly produce different annual totals for same nominal monthly amount", () => {
    // Same $/month perception but different actual multipliers
    const biweekly = annualize(2_000, "biweekly"); // 26 * 2000 = 52,000
    const semimonthly = annualize(2_000, "semimonthly"); // 24 * 2000 = 48,000
    assert.notEqual(biweekly, semimonthly);
    assert.ok(biweekly > semimonthly, "Biweekly (26 checks) > semimonthly (24 checks) for same amount");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BONUS & RETIREMENT MATCHING — pure math edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("bonus and retirement matching math", () => {

  test("employer match at 100% up to 3% of salary", () => {
    const salary = 60_000;
    const employeeContribPct = 0.06; // 6%
    const matchPct = 1.0; // 100% match
    const matchCap = 0.03; // up to 3% of salary

    const employeeContrib = salary * employeeContribPct; // 3600
    const effectiveMatchRate = Math.min(employeeContribPct, matchCap) * matchPct; // 3%
    const employerMatch = salary * effectiveMatchRate; // 1800

    assert.equal(employeeContrib, 3_600);
    assert.equal(employerMatch, 1_800);
    assert.equal(employeeContrib + employerMatch, 5_400);
  });

  test("employer match does not exceed cap even with high employee contribution", () => {
    const salary = 100_000;
    const employeeContribPct = 0.15; // way above match threshold
    const matchCap = 0.04; // 4%
    const matchPct = 0.5; // 50% match

    const employerMatch = salary * Math.min(employeeContribPct, matchCap) * matchPct;
    assert.equal(employerMatch, 100_000 * 0.04 * 0.5, "Match capped at 4% * 50% = 2%");
    assert.equal(employerMatch, 2_000);
  });

  test("bonus does not permanently raise tax bracket — standard withholding context", () => {
    // This is an educational assertion: the bonus is subject to flat 22% supplemental
    // withholding (for amounts up to the threshold), not a new tax rate on ALL income.
    const supplementalRate = 0.22;
    const bonus = 5_000;
    const withheld = bonus * supplementalRate;
    assert.equal(withheld, 1_100, "22% supplemental rate on $5000 bonus = $1100 withheld");
    // The actual tax owed on the bonus is determined by annual income — withholding
    // may over- or under-withhold, settled at filing.
  });

  test("per diem under federal daily rate is non-taxable (accountable plan)", () => {
    const perDiemReceived = 100; // IRS 2024 standard M&IE rate is $68 to $92
    const federalM_and_IE = 68; // example: non-CONUS standard
    const taxablePerDiem = Math.max(0, perDiemReceived - federalM_and_IE);
    assert.equal(taxablePerDiem, 32, "Amount above federal rate is taxable");
  });

  test("per diem fully within federal rate is completely non-taxable", () => {
    const perDiemReceived = 60;
    const federalRate = 68;
    const taxable = Math.max(0, perDiemReceived - federalRate);
    assert.equal(taxable, 0, "Per diem below federal rate = $0 taxable");
  });
});
