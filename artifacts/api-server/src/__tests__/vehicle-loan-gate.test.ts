/**
 * vehicle-loan-gate.test.ts
 *
 * Integration test: verifies that a valid normalized Auto Loan payload
 * produces no false-blocking gate flags.  Regression guard for the
 * field-name mapping bug where balanceOwed/accountLast4 (vehicle-loan
 * canonical names) were passed directly to checkConfidence(), which
 * expects currentBalance/lastFour (Loan spec names).
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { checkConfidence } from "../lib/confidence-thresholds.js";
import { reconcile } from "../lib/reconciliation.js";
import { detectErrorPatterns } from "../lib/error-patterns.js";
import { buildGateResult } from "../lib/extraction-field.js";

// ── Helper: simulate the mapping applied in scan.ts fast path ────────────────

function makeVehicleGateFields(balanceOwed: number, apr: number, accountLast4: string | null) {
  const conf = 85;
  return {
    currentBalance: { value: balanceOwed,   confidence: conf },   // mapped from balanceOwed
    apr:            { value: apr,            confidence: conf },
    monthlyPayment: { value: 372,            confidence: conf },
    nextDueDate:    { value: "2026-08-15",   confidence: conf },   // day > 12 → no date ambiguity
    lastFour:       { value: accountLast4,   confidence: conf },   // mapped from accountLast4
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Auto Loan fast-path gate — no false-blocking for valid payloads", () => {
  test("valid Auto Loan extraction produces no blocking gate flags", () => {
    const fields = makeVehicleGateFields(18500, 6.99, "5678");

    const confidenceFlags = checkConfidence("Auto Loan", fields);
    const reconciliationWarnings = reconcile("Auto Loan", fields);
    const errorPatternFlags = detectErrorPatterns(fields, "Auto Loan");
    const gate = buildGateResult(confidenceFlags, reconciliationWarnings, errorPatternFlags);

    assert.strictEqual(
      gate.hasBlockingIssues, false,
      `Expected no blocking issues for valid Auto Loan. Got: ${JSON.stringify(
        [...gate.confidenceFlags, ...gate.reconciliationWarnings, ...gate.errorPatternFlags]
          .filter(f => ('severity' in f ? f.severity === 'blocking' : false))
          .map(f => ('rule' in f ? f.rule : ('pattern' in f ? f.pattern : f.field))),
      )}`,
    );
  });

  test("old field names (balanceOwed, accountLast4) cause false-blocking — documents the bug", () => {
    // BEFORE the fix: vehicleGateFields was built with the wrong key names.
    // This test documents that passing them RAW (without mapping) triggers a false block.
    const fieldsWithWrongKeys = {
      balanceOwed:   { value: 18500, confidence: 85 },   // NOT currentBalance
      apr:           { value: 6.99,  confidence: 85 },
      monthlyPayment: { value: 372,  confidence: 85 },
      accountLast4:  { value: "5678", confidence: 85 },  // NOT lastFour
    };

    const confidenceFlags = checkConfidence("Auto Loan", fieldsWithWrongKeys);
    // currentBalance is requiredPresent:true highImpact:true for Loan → blocking when absent
    const blockingConf = confidenceFlags.filter(f => f.severity === "blocking");
    assert.ok(
      blockingConf.length > 0,
      "Using wrong field names (balanceOwed instead of currentBalance) should produce a blocking flag — confirms the regression scenario",
    );
  });

  test("valid Auto Loan with null accountLast4 still produces no blocking flags", () => {
    // lastFour is requiredPresent:false for Loan → absent is fine
    const fields = makeVehicleGateFields(18500, 6.99, null);

    const confidenceFlags = checkConfidence("Auto Loan", fields);
    const blockingConf = confidenceFlags.filter(f => f.severity === "blocking");
    assert.strictEqual(
      blockingConf.length, 0,
      "Absent lastFour (non-required) should not produce blocking flags",
    );
  });

  test("APR > 100 on Auto Loan is detected as percentage-scaling error (advisory)", () => {
    const fields = makeVehicleGateFields(18500, 699, "5678"); // APR entered as basis points
    const errorPatternFlags = detectErrorPatterns(fields, "Auto Loan");
    const f = errorPatternFlags.find(fl => fl.pattern === "percentage-scaling" && fl.field === "apr");
    assert.ok(f, "APR=699 should flag percentage-scaling");
    assert.strictEqual(f.severity, "advisory", "percentage-scaling is always advisory");
  });
});
