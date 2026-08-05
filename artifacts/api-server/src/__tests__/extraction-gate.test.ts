/**
 * extraction-gate.test.ts
 *
 * Unit tests for all four extraction accuracy gate modules:
 *   - extraction-field.ts   (types, helpers)
 *   - confidence-thresholds.ts (checkConfidence)
 *   - reconciliation.ts    (reconcile)
 *   - error-patterns.ts    (detectErrorPatterns)
 *   - accuracy-reporter.ts (computeAccuracyMetrics, launchGateCheck)
 *
 * Also verifies behavior across all 22 fixture scenarios.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  makeExtractionField,
  effectiveValue,
  applyUserEdit,
  addWarning,
  wasEdited,
  hasBlockingWarnings,
  finalizeField,
  buildGateResult,
} from "../lib/extraction-field.js";
import {
  resolveCategory,
  checkConfidence,
} from "../lib/confidence-thresholds.js";
import { reconcile } from "../lib/reconciliation.js";
import { detectErrorPatterns } from "../lib/error-patterns.js";
import {
  computeAccuracyMetrics,
  launchGateCheck,
  type GateTestResult,
} from "../lib/accuracy-reporter.js";
import { ALL_GATE_SCENARIOS } from "./fixtures/gate-scenarios.js";

// ─── extraction-field.ts ──────────────────────────────────────────────────────

describe("ExtractionField helpers", () => {
  test("makeExtractionField creates a field with no warnings", () => {
    const f = makeExtractionField(100, 85);
    assert.strictEqual(f.rawValue, 100);
    assert.strictEqual(f.confidence, 85);
    assert.strictEqual(f.warnings.length, 0);
    assert.strictEqual(f.userEditedValue, undefined);
  });

  test("effectiveValue returns rawValue when not edited", () => {
    const f = makeExtractionField("hello", 80);
    assert.strictEqual(effectiveValue(f), "hello");
  });

  test("effectiveValue returns userEditedValue when edited", () => {
    const f = applyUserEdit(makeExtractionField("hello", 80), "world");
    assert.strictEqual(effectiveValue(f), "world");
  });

  test("applyUserEdit is immutable — original unchanged", () => {
    const original = makeExtractionField("hello", 80);
    const edited = applyUserEdit(original, "world");
    assert.strictEqual(original.userEditedValue, undefined);
    assert.strictEqual(edited.userEditedValue, "world");
  });

  test("wasEdited returns false before edit, true after", () => {
    const f = makeExtractionField(42, 90);
    assert.strictEqual(wasEdited(f), false);
    assert.strictEqual(wasEdited(applyUserEdit(f, 99)), true);
  });

  test("addWarning appends a warning", () => {
    const f = makeExtractionField(42, 90);
    const warned = addWarning(f, { code: "TEST", message: "test", severity: "advisory" });
    assert.strictEqual(warned.warnings.length, 1);
    assert.strictEqual(f.warnings.length, 0); // original unchanged
  });

  test("hasBlockingWarnings detects blocking warnings", () => {
    const f = addWarning(makeExtractionField(42, 90), {
      code: "BLOCK", message: "block", severity: "blocking",
    });
    assert.strictEqual(hasBlockingWarnings(f), true);
    const advisory = addWarning(makeExtractionField(42, 90), {
      code: "ADV", message: "adv", severity: "advisory",
    });
    assert.strictEqual(hasBlockingWarnings(advisory), false);
  });

  test("finalizeField summarizes field correctly", () => {
    const edited = applyUserEdit(
      addWarning(makeExtractionField(100, 90), { code: "X", message: "x", severity: "blocking" }),
      200,
    );
    const result = finalizeField(edited);
    assert.strictEqual(result.value, 200);
    assert.strictEqual(result.wasEdited, true);
    assert.strictEqual(result.hasBlockingWarnings, true);
  });

  test("buildGateResult computes hasBlockingIssues from all three flag types", () => {
    const noIssues = buildGateResult([], [], []);
    assert.strictEqual(noIssues.hasBlockingIssues, false);

    const withBlockingConf = buildGateResult(
      [{ field: "x", label: "X", category: "Paystub", required: true,
         actualConfidence: null, minimumRequired: 70, severity: "blocking", message: "m" }],
      [], [],
    );
    assert.strictEqual(withBlockingConf.hasBlockingIssues, true);
  });
});

// ─── confidence-thresholds.ts ─────────────────────────────────────────────────

describe("resolveCategory", () => {
  test("resolves Paystub correctly", () => {
    assert.strictEqual(resolveCategory("Paystub"), "Paystub");
  });
  test("resolves banking variants", () => {
    assert.strictEqual(resolveCategory("Checking Account"), "Banking");
    assert.strictEqual(resolveCategory("Savings Account"), "Banking");
    assert.strictEqual(resolveCategory("Bank Statement"), "Banking");
  });
  test("resolves credit card variants", () => {
    assert.strictEqual(resolveCategory("Credit Card"), "CreditCard");
    assert.strictEqual(resolveCategory("Credit Card Statement"), "CreditCard");
  });
  test("resolves loan variants", () => {
    assert.strictEqual(resolveCategory("Auto Loan"), "Loan");
    assert.strictEqual(resolveCategory("Personal Loan"), "Loan");
  });
  test("resolves mortgage and HELOC", () => {
    assert.strictEqual(resolveCategory("Mortgage"), "Mortgage");
    assert.strictEqual(resolveCategory("HELOC"), "HELOC");
  });
  test("resolves retirement variants", () => {
    assert.strictEqual(resolveCategory("401(k)"), "Retirement");
    assert.strictEqual(resolveCategory("Roth IRA"), "Retirement");
  });
  test("resolves bill variants", () => {
    assert.strictEqual(resolveCategory("Monthly Bill"), "Bill");
    assert.strictEqual(resolveCategory("Utility Bill"), "Bill");
  });
  test("returns Unknown for unrecognized types", () => {
    assert.strictEqual(resolveCategory("Fax Statement"), "Unknown");
    assert.strictEqual(resolveCategory(""), "Unknown");
  });
});

describe("checkConfidence", () => {
  test("returns no flags for a complete high-confidence paystub", () => {
    const fields = {
      employer: { value: "ACME", confidence: 90 },
      grossPay: { value: 2400, confidence: 85 },
      netPay:   { value: 1800, confidence: 85 },
    };
    const flags = checkConfidence("Paystub", fields);
    assert.strictEqual(flags.length, 0);
  });

  test("returns blocking flag when grossPay is missing from paystub", () => {
    const fields = {
      employer: { value: "ACME", confidence: 90 },
      netPay:   { value: 1800, confidence: 85 },
    };
    const flags = checkConfidence("Paystub", fields);
    const grossFlag = flags.find(f => f.field === "grossPay");
    assert.ok(grossFlag, "grossPay flag should exist");
    assert.strictEqual(grossFlag.severity, "blocking");
    assert.strictEqual(grossFlag.actualConfidence, null);
  });

  test("returns advisory flag when grossPay confidence is slightly below threshold", () => {
    const fields = {
      employer: { value: "ACME", confidence: 90 },
      grossPay: { value: 2400, confidence: 60 },  // below 70 but not drastically
      netPay:   { value: 1800, confidence: 85 },
    };
    const flags = checkConfidence("Paystub", fields);
    const grossFlag = flags.find(f => f.field === "grossPay");
    assert.ok(grossFlag, "grossPay flag should exist");
    assert.strictEqual(grossFlag.severity, "advisory");
  });

  test("returns blocking when grossPay confidence is very low", () => {
    const fields = {
      employer: { value: "ACME", confidence: 90 },
      grossPay: { value: 2400, confidence: 45 },  // 45 < 70-15=55 → blocking
      netPay:   { value: 1800, confidence: 85 },
    };
    const flags = checkConfidence("Paystub", fields);
    const grossFlag = flags.find(f => f.field === "grossPay");
    assert.strictEqual(grossFlag?.severity, "blocking");
  });

  test("returns blocking when currentBalance missing from credit card", () => {
    const flags = checkConfidence("Credit Card", {
      lastFour: { value: "1234", confidence: 90 },
      apr: { value: 19.99, confidence: 88 },
    });
    const balFlag = flags.find(f => f.field === "currentBalance");
    assert.strictEqual(balFlag?.severity, "blocking");
  });

  test("returns no flags for Unknown category", () => {
    const flags = checkConfidence("Multiple Documents", { anyField: { value: 100, confidence: 90 } });
    assert.strictEqual(flags.length, 0);
  });
});

// ─── reconciliation.ts ────────────────────────────────────────────────────────

describe("reconcile — Paystub", () => {
  test("returns no warnings when net < gross", () => {
    const warnings = reconcile("Paystub", {
      grossPay: { value: 2400, confidence: 90 },
      netPay:   { value: 1800, confidence: 90 },
    });
    assert.strictEqual(warnings.filter(w => w.rule === "net_exceeds_gross").length, 0);
  });

  test("returns blocking warning when net >= gross", () => {
    const warnings = reconcile("Paystub", {
      grossPay: { value: 1800, confidence: 90 },
      netPay:   { value: 2400, confidence: 90 },
    });
    const w = warnings.find(w => w.rule === "net_exceeds_gross");
    assert.ok(w, "should have net_exceeds_gross warning");
    assert.strictEqual(w.severity, "blocking");
  });

  test("flags pay mismatch when taxes are present and net is off", () => {
    const warnings = reconcile("Paystub", {
      grossPay:    { value: 2400, confidence: 90 },
      netPay:      { value: 2300, confidence: 90 },  // should be ~1936.20
      federalTax:  { value: 288, confidence: 88 },
      stateTax:    { value: 96, confidence: 88 },
      socialSecurity: { value: 148.8, confidence: 88 },
      medicare:    { value: 34.8, confidence: 88 },
    });
    const mismatch = warnings.find(w => w.rule === "net_pay_mismatch");
    assert.ok(mismatch, "should have net_pay_mismatch warning");
  });
});

describe("reconcile — Banking", () => {
  test("returns warning when closing balance doesn't reconcile", () => {
    const warnings = reconcile("Checking Account", {
      closingBalance:   { value: 7000, confidence: 90 },
      openingBalance:   { value: 5000, confidence: 88 },
      totalDeposits:    { value: 1500, confidence: 88 },
      totalWithdrawals: { value: 1065, confidence: 88 },
      // expected: 5000 + 1500 - 1065 = 5435, got 7000
    });
    assert.ok(warnings.find(w => w.rule === "statement_balance_mismatch"),
      "should have statement_balance_mismatch warning");
  });

  test("returns no warning when balance reconciles", () => {
    const warnings = reconcile("Bank Statement", {
      closingBalance:   { value: 5435, confidence: 90 },
      openingBalance:   { value: 5000, confidence: 88 },
      totalDeposits:    { value: 1500, confidence: 88 },
      totalWithdrawals: { value: 1065, confidence: 88 },
    });
    assert.strictEqual(
      warnings.filter(w => w.rule === "statement_balance_mismatch").length, 0,
    );
  });
});

describe("reconcile — Credit Card", () => {
  test("returns blocking when balance exceeds limit", () => {
    const warnings = reconcile("Credit Card", {
      currentBalance: { value: 6000, confidence: 90 },
      creditLimit:    { value: 5000, confidence: 90 },
    });
    const w = warnings.find(w => w.rule === "balance_exceeds_limit");
    assert.ok(w, "should have balance_exceeds_limit warning");
    assert.strictEqual(w.severity, "blocking");
  });

  test("returns advisory for available credit mismatch", () => {
    const warnings = reconcile("Credit Card Statement", {
      currentBalance:  { value: 2000, confidence: 90 },
      creditLimit:     { value: 5000, confidence: 90 },
      availableCredit: { value: 2500, confidence: 90 },  // should be 3000
    });
    assert.ok(warnings.find(w => w.rule === "available_credit_mismatch"),
      "should have available_credit_mismatch");
  });
});

describe("reconcile — Mortgage", () => {
  test("returns advisory when P&I + escrow != monthly payment", () => {
    const warnings = reconcile("Mortgage", {
      monthlyPayment:       { value: 2078, confidence: 90 },
      principalAndInterest: { value: 1000, confidence: 88 },
      escrowAmount:         { value: 330, confidence: 88 },
    });
    assert.ok(warnings.find(w => w.rule === "payment_components_mismatch"),
      "should have payment_components_mismatch");
  });
});

describe("reconcile — Retirement", () => {
  test("flags when vested balance exceeds current", () => {
    const warnings = reconcile("401(k)", {
      currentBalance: { value: 75000, confidence: 90 },
      vestedBalance:  { value: 87500, confidence: 88 },
    });
    assert.ok(warnings.find(w => w.rule === "vested_exceeds_total"),
      "should have vested_exceeds_total warning");
  });
});

describe("reconcile — statement period", () => {
  test("flags when end is before start", () => {
    const warnings = reconcile("Savings Account", {
      statementStartDate: { value: "2026-07-31", confidence: 88 },
      statementEndDate:   { value: "2026-07-01", confidence: 88 },
    });
    assert.ok(warnings.find(w => w.rule === "period_end_before_start"),
      "should have period_end_before_start warning");
  });
});

// ─── error-patterns.ts ────────────────────────────────────────────────────────

describe("detectErrorPatterns — decimal shift", () => {
  test("flags when grossPay is 100x too large (>10x the upper bound)", () => {
    // grossPay upper bound = 50_000; > 500_000 triggers decimal-shift
    const flags = detectErrorPatterns({ grossPay: { value: 6_000_000, confidence: 90 } });
    assert.ok(flags.find(f => f.pattern === "decimal-shift" && f.field === "grossPay"),
      "should flag decimal shift on grossPay when >10x upper bound (50k)");
  });

  test("flags grossPay of 240000 as missing-decimal (round int ≥10k, divisor makes sense)", () => {
    // 240000 is a round integer ≥10k and 240000/100=2400 is plausible → missing-decimal pattern
    const flags = detectErrorPatterns({ grossPay: { value: 240000, confidence: 90 } });
    assert.ok(flags.find(f => f.pattern === "missing-decimal" && f.field === "grossPay"),
      "should flag missing-decimal on grossPay=240000");
  });

  test("doesn't flag reasonable grossPay", () => {
    const flags = detectErrorPatterns({ grossPay: { value: 2400, confidence: 90 } });
    assert.strictEqual(
      flags.filter(f => f.pattern === "decimal-shift" && f.field === "grossPay").length, 0,
    );
  });
});

describe("detectErrorPatterns — sign reversal", () => {
  test("flags negative grossPay", () => {
    const flags = detectErrorPatterns({ grossPay: { value: -2400, confidence: 90 } });
    assert.ok(flags.find(f => f.pattern === "sign-reversal" && f.field === "grossPay"),
      "should flag sign reversal on grossPay");
  });
});

describe("detectErrorPatterns — OCR substitutions", () => {
  test("flags lastFour with O instead of 0", () => {
    const flags = detectErrorPatterns({ lastFour: { value: "9O76", confidence: 90 } });
    const f = flags.find(fl => fl.pattern === "ocr-substitution" && fl.field === "lastFour");
    assert.ok(f, "should flag OCR substitution on lastFour");
    assert.strictEqual(f.suggestedValue, "9076");
  });

  test("doesn't flag clean numeric lastFour", () => {
    const flags = detectErrorPatterns({ lastFour: { value: "9076", confidence: 90 } });
    assert.strictEqual(flags.filter(f => f.pattern === "ocr-substitution").length, 0);
  });
});

describe("detectErrorPatterns — percentage scaling", () => {
  test("flags APR > 100", () => {
    const flags = detectErrorPatterns({ apr: { value: 650, confidence: 90 } });
    const f = flags.find(fl => fl.pattern === "percentage-scaling" && fl.field === "apr");
    assert.ok(f, "should flag percentage scaling on APR");
    assert.ok(Math.abs((f.suggestedValue as number) - 6.5) < 0.001, "suggested value should be ~6.5");
  });

  test("flags APR as decimal fraction when value < 0.01", () => {
    // The threshold is v < 0.01; e.g. 0.065 is ABOVE the threshold and not flagged.
    // A value like 0.005 (stored as 0.5%) clearly triggers it.
    const flags = detectErrorPatterns({ apr: { value: 0.005, confidence: 90 } });
    const f = flags.find(fl => fl.pattern === "percentage-scaling" && fl.field === "apr");
    assert.ok(f, "should flag percentage scaling for APR < 0.01 (decimal fraction)");
    assert.ok(Math.abs((f.suggestedValue as number) - 0.5) < 0.001, "suggested value should be ~0.5");
  });

  test("doesn't flag normal APR", () => {
    const flags = detectErrorPatterns({ apr: { value: 6.5, confidence: 90 } });
    assert.strictEqual(
      flags.filter(f => f.pattern === "percentage-scaling" && f.field === "apr").length, 0,
    );
  });
});

describe("detectErrorPatterns — date ambiguity", () => {
  test("flags when month and day are both ≤ 12 and different", () => {
    const flags = detectErrorPatterns({ dueDate: { value: "2026-08-07", confidence: 88 } });
    assert.ok(flags.find(f => f.pattern === "date-format-ambiguous" && f.field === "dueDate"),
      "should flag ambiguous date");
  });

  test("doesn't flag when day > 12", () => {
    const flags = detectErrorPatterns({ dueDate: { value: "2026-08-20", confidence: 88 } });
    assert.strictEqual(
      flags.filter(f => f.pattern === "date-format-ambiguous" && f.field === "dueDate").length, 0,
    );
  });
});

describe("detectErrorPatterns — implausible values", () => {
  test("flags hourlyRate > 10000", () => {
    const flags = detectErrorPatterns({ hourlyRate: { value: 50000, confidence: 90 } });
    assert.ok(flags.find(f => f.pattern === "implausible-value" && f.field === "hourlyRate"),
      "should flag implausible hourly rate");
  });

  test("doesn't flag reasonable hourlyRate", () => {
    const flags = detectErrorPatterns({ hourlyRate: { value: 30, confidence: 90 } });
    assert.strictEqual(
      flags.filter(f => f.pattern === "implausible-value" && f.field === "hourlyRate").length, 0,
    );
  });
});

describe("detectErrorPatterns — statement period conflict", () => {
  test("flags when end is before start", () => {
    const flags = detectErrorPatterns({
      statementStartDate: { value: "2026-07-31", confidence: 88 },
      statementEndDate:   { value: "2026-07-01", confidence: 88 },
    });
    assert.ok(flags.find(f => f.pattern === "statement-period-conflict"),
      "should flag statement period conflict");
  });
});

// ─── Fixture scenario suite ───────────────────────────────────────────────────

describe("Gate — fixture scenarios", () => {
  for (const scenario of ALL_GATE_SCENARIOS) {
    test(`[${scenario.id}] ${scenario.description}`, () => {
      const confidenceFlags = checkConfidence(scenario.docType, scenario.fields);
      const reconciliationWarnings = reconcile(scenario.docType, scenario.fields);
      const errorPatternFlags = detectErrorPatterns(scenario.fields, scenario.docType);
      const gate = buildGateResult(confidenceFlags, reconciliationWarnings, errorPatternFlags);

      const hasAnyFlag =
        gate.confidenceFlags.length > 0 ||
        gate.reconciliationWarnings.length > 0 ||
        gate.errorPatternFlags.length > 0;

      if (scenario.expectsClean) {
        assert.strictEqual(hasAnyFlag, false,
          `${scenario.id}: expected clean (no flags) but got flags: ` +
          JSON.stringify([...gate.confidenceFlags, ...gate.reconciliationWarnings, ...gate.errorPatternFlags].map(f => ('rule' in f ? f.rule : ('pattern' in f ? f.pattern : f.field)))));
      }
      if (scenario.expectsBlocking) {
        assert.strictEqual(gate.hasBlockingIssues, true,
          `${scenario.id}: expected blocking issues but got none`);
      }
      if (scenario.expectsAdvisory && !scenario.expectsBlocking) {
        assert.strictEqual(hasAnyFlag, true,
          `${scenario.id}: expected advisory flags but got none`);
        assert.strictEqual(gate.hasBlockingIssues, false,
          `${scenario.id}: expected advisory only but got blocking issues`);
      }
    });
  }
});

// ─── accuracy-reporter.ts ─────────────────────────────────────────────────────

describe("computeAccuracyMetrics", () => {
  test("returns zeroes for empty results", () => {
    const m = computeAccuracyMetrics([]);
    assert.strictEqual(m.flagRaiseRate, 0);
    assert.strictEqual(m.savePrecision, 0);
  });

  test("computes flag raise rate and blocking detection correctly", () => {
    const results: GateTestResult[] = [
      {
        id: "a", category: "Paystub", hasKnownErrors: false,
        gate: buildGateResult([], [], []),
        savedByUser: true, allSavedValuesCorrect: true,
      },
      {
        id: "b", category: "Paystub", hasKnownErrors: true,
        gate: buildGateResult(
          [{ field: "x", label: "X", category: "Paystub", required: true,
             actualConfidence: null, minimumRequired: 70, severity: "blocking", message: "m" }],
          [], [],
        ),
        savedByUser: false, allSavedValuesCorrect: false,
      },
    ];
    const m = computeAccuracyMetrics(results);
    assert.strictEqual(m.flagRaiseRate, 0.5);
    assert.strictEqual(m.blockingDetectionRate, 1.0);
    assert.strictEqual(m.falseBlockingRate, 0.0);
  });
});

describe("launchGateCheck", () => {
  test("passes all criteria when precision is perfect and no false positives", () => {
    const results: GateTestResult[] = [
      {
        id: "clean", category: "Paystub", hasKnownErrors: false,
        gate: buildGateResult([], [], []),
        savedByUser: true, allSavedValuesCorrect: true,
      },
      {
        id: "error", category: "Paystub", hasKnownErrors: true,
        gate: buildGateResult(
          [{ field: "grossPay", label: "Gross pay", category: "Paystub", required: true,
             actualConfidence: null, minimumRequired: 70, severity: "blocking", message: "m" }],
          [], [],
        ),
        savedByUser: false, allSavedValuesCorrect: false,
      },
    ];
    const report = launchGateCheck(results);
    const blockingCrit = report.criteria.find(c => c.name === "Blocking detection rate");
    const falseCrit = report.criteria.find(c => c.name === "False blocking rate");
    const savePrecCrit = report.criteria.find(c => c.name === "Save precision");
    assert.strictEqual(blockingCrit?.passed, true);
    assert.strictEqual(falseCrit?.passed, true);
    assert.strictEqual(savePrecCrit?.passed, true);
  });

  test("fails save-rate criterion when nothing is saved", () => {
    const results: GateTestResult[] = [
      {
        id: "a", category: "Paystub", hasKnownErrors: false,
        gate: buildGateResult(
          [{ field: "grossPay", label: "Gross pay", category: "Paystub", required: true,
             actualConfidence: null, minimumRequired: 70, severity: "blocking", message: "m" }],
          [], [],
        ),
        savedByUser: false, allSavedValuesCorrect: false,
      },
    ];
    const report = launchGateCheck(results);
    const saveRateCriterion = report.criteria.find(c => c.name === "Save rate");
    assert.strictEqual(saveRateCriterion?.passed, false);
  });
});
