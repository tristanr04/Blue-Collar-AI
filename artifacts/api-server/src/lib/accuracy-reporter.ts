/**
 * accuracy-reporter.ts
 *
 * Computes 9 accuracy metrics across the extraction gate and evaluates
 * 5 launch-gate criteria.
 *
 * Intended usage: feed it an array of GateTestResult objects produced by
 * running the gate over the fixture suite (or real scans) and call
 * launchGateCheck() to get a pass/fail report.
 *
 * Pure, stateless — no I/O.
 */

import type { GateResult } from "./extraction-field.js";

// ─── Per-document gate test result ────────────────────────────────────────────

export interface GateTestResult {
  /** Fixture or document identifier */
  id: string;
  /** Document category label */
  category: string;
  /** Whether the document is expected to have errors (fixture metadata) */
  hasKnownErrors: boolean;
  /** The gate output for this document */
  gate: GateResult;
  /** True if the document was accepted and saved (not blocked by the gate) */
  savedByUser: boolean;
  /** True if all values that were saved are correct per fixture ground truth */
  allSavedValuesCorrect: boolean;
}

// ─── 9 accuracy metrics ───────────────────────────────────────────────────────

export interface AccuracyMetrics {
  /** 1. Fraction of documents where at least one gate flag was raised */
  flagRaiseRate: number;
  /** 2. Fraction of "has known errors" documents where at least one blocking flag was raised */
  blockingDetectionRate: number;
  /** 3. Fraction of "no known errors" documents where a blocking flag was raised (false positives) */
  falseBlockingRate: number;
  /** 4. Fraction of saves where all saved values are correct */
  savePrecision: number;
  /** 5. Fraction of advisory-only-flag documents that were saved with all values correct */
  advisoryAcceptanceAccuracy: number;
  /** 6. Average number of flags per flagged document */
  averageFlagsPerFlagged: number;
  /** 7. Fraction of documents that were saved (not hard-blocked by user) */
  saveRate: number;
  /** 8. Fraction of confidence flags vs all flags */
  confidenceFlagShare: number;
  /** 9. Fraction of error-pattern flags vs all flags */
  errorPatternFlagShare: number;
}

export function computeAccuracyMetrics(results: GateTestResult[]): AccuracyMetrics {
  if (results.length === 0) {
    return {
      flagRaiseRate: 0, blockingDetectionRate: 0, falseBlockingRate: 0,
      savePrecision: 0, advisoryAcceptanceAccuracy: 0,
      averageFlagsPerFlagged: 0, saveRate: 0,
      confidenceFlagShare: 0, errorPatternFlagShare: 0,
    };
  }

  const n = results.length;
  const flagged = results.filter(r =>
    r.gate.confidenceFlags.length > 0 ||
    r.gate.reconciliationWarnings.length > 0 ||
    r.gate.errorPatternFlags.length > 0,
  );

  const knownErrorDocs  = results.filter(r => r.hasKnownErrors);
  const cleanDocs       = results.filter(r => !r.hasKnownErrors);
  const savedDocs       = results.filter(r => r.savedByUser);
  const advisoryOnlyDocs = results.filter(r =>
    !r.gate.hasBlockingIssues &&
    (r.gate.confidenceFlags.length > 0 ||
     r.gate.reconciliationWarnings.length > 0 ||
     r.gate.errorPatternFlags.length > 0),
  );

  // Metric 1: flag raise rate
  const flagRaiseRate = flagged.length / n;

  // Metric 2: blocking detection rate (recall on error docs)
  const blockingDetectionRate = knownErrorDocs.length > 0
    ? knownErrorDocs.filter(r => r.gate.hasBlockingIssues).length / knownErrorDocs.length
    : 1; // no error docs → trivially 100%

  // Metric 3: false blocking rate (FP on clean docs)
  const falseBlockingRate = cleanDocs.length > 0
    ? cleanDocs.filter(r => r.gate.hasBlockingIssues).length / cleanDocs.length
    : 0;

  // Metric 4: save precision
  const savePrecision = savedDocs.length > 0
    ? savedDocs.filter(r => r.allSavedValuesCorrect).length / savedDocs.length
    : 1;

  // Metric 5: advisory acceptance accuracy
  const advisoryAcceptanceAccuracy = advisoryOnlyDocs.length > 0
    ? advisoryOnlyDocs.filter(r => r.savedByUser && r.allSavedValuesCorrect).length /
      advisoryOnlyDocs.filter(r => r.savedByUser).length || 1
    : 1;

  // Metric 6: average flags per flagged doc
  const totalFlags = flagged.reduce((acc, r) =>
    acc +
    r.gate.confidenceFlags.length +
    r.gate.reconciliationWarnings.length +
    r.gate.errorPatternFlags.length, 0);
  const averageFlagsPerFlagged = flagged.length > 0 ? totalFlags / flagged.length : 0;

  // Metric 7: save rate
  const saveRate = savedDocs.length / n;

  // Metric 8 & 9: flag type distribution
  const totalConfidenceFlags = results.reduce((acc, r) => acc + r.gate.confidenceFlags.length, 0);
  const totalErrorPatternFlags = results.reduce((acc, r) => acc + r.gate.errorPatternFlags.length, 0);
  const totalAllFlags = results.reduce((acc, r) =>
    acc + r.gate.confidenceFlags.length + r.gate.reconciliationWarnings.length + r.gate.errorPatternFlags.length, 0);

  const confidenceFlagShare = totalAllFlags > 0 ? totalConfidenceFlags / totalAllFlags : 0;
  const errorPatternFlagShare = totalAllFlags > 0 ? totalErrorPatternFlags / totalAllFlags : 0;

  return {
    flagRaiseRate,
    blockingDetectionRate,
    falseBlockingRate,
    savePrecision,
    advisoryAcceptanceAccuracy,
    averageFlagsPerFlagged,
    saveRate,
    confidenceFlagShare,
    errorPatternFlagShare,
  };
}

// ─── 5 launch-gate criteria ───────────────────────────────────────────────────

export interface LaunchGateCriterion {
  name: string;
  description: string;
  threshold: string;
  actual: number | string;
  passed: boolean;
}

export interface LaunchGateReport {
  passed: boolean;
  criteria: LaunchGateCriterion[];
  metrics: AccuracyMetrics;
  summary: string;
}

/**
 * Evaluate 5 launch-gate criteria against computed accuracy metrics.
 * All 5 must pass for the gate to be considered production-ready.
 */
export function launchGateCheck(results: GateTestResult[]): LaunchGateReport {
  const metrics = computeAccuracyMetrics(results);

  const criteria: LaunchGateCriterion[] = [
    {
      name: 'Blocking detection rate',
      description: 'Gate must block ≥80% of documents with known errors.',
      threshold: '≥ 0.80',
      actual: metrics.blockingDetectionRate,
      passed: metrics.blockingDetectionRate >= 0.80,
    },
    {
      name: 'False blocking rate',
      description: 'Gate must not block > 10% of clean (error-free) documents.',
      threshold: '≤ 0.10',
      actual: metrics.falseBlockingRate,
      passed: metrics.falseBlockingRate <= 0.10,
    },
    {
      name: 'Save precision',
      description: 'When a user saves, ≥95% of saved values must be correct.',
      threshold: '≥ 0.95',
      actual: metrics.savePrecision,
      passed: metrics.savePrecision >= 0.95,
    },
    {
      name: 'Advisory acceptance accuracy',
      description: 'When the user accepts advisory warnings and saves, ≥90% must be correct.',
      threshold: '≥ 0.90',
      actual: metrics.advisoryAcceptanceAccuracy,
      passed: metrics.advisoryAcceptanceAccuracy >= 0.90,
    },
    {
      name: 'Save rate',
      description: 'At least 70% of documents should be saved (gate should not over-block).',
      threshold: '≥ 0.70',
      actual: metrics.saveRate,
      passed: metrics.saveRate >= 0.70,
    },
  ];

  const passed = criteria.every(c => c.passed);
  const failedNames = criteria.filter(c => !c.passed).map(c => c.name);

  const summary = passed
    ? `All 5 launch-gate criteria passed. Save precision: ${(metrics.savePrecision * 100).toFixed(1)}%, blocking detection: ${(metrics.blockingDetectionRate * 100).toFixed(1)}%.`
    : `Launch gate FAILED. ${failedNames.length} criterion/criteria not met: ${failedNames.join(', ')}.`;

  return { passed, criteria, metrics, summary };
}

// ─── Text report formatter ────────────────────────────────────────────────────

export function formatLaunchGateReport(report: LaunchGateReport): string {
  const lines: string[] = [
    `# Extraction Accuracy Launch Gate Report`,
    `Status: ${report.passed ? '✅ PASSED' : '❌ FAILED'}`,
    ``,
    `## Launch Criteria`,
  ];

  for (const c of report.criteria) {
    const icon = c.passed ? '✅' : '❌';
    lines.push(`${icon} **${c.name}** (${c.threshold}): actual = ${
      typeof c.actual === 'number' ? (c.actual * 100).toFixed(1) + '%' : c.actual
    }`);
    if (!c.passed) lines.push(`   → ${c.description}`);
  }

  lines.push(``, `## Accuracy Metrics`);
  const m = report.metrics;
  lines.push(`- Flag raise rate: ${(m.flagRaiseRate * 100).toFixed(1)}%`);
  lines.push(`- Blocking detection rate: ${(m.blockingDetectionRate * 100).toFixed(1)}%`);
  lines.push(`- False blocking rate: ${(m.falseBlockingRate * 100).toFixed(1)}%`);
  lines.push(`- Save precision: ${(m.savePrecision * 100).toFixed(1)}%`);
  lines.push(`- Advisory acceptance accuracy: ${(m.advisoryAcceptanceAccuracy * 100).toFixed(1)}%`);
  lines.push(`- Average flags per flagged doc: ${m.averageFlagsPerFlagged.toFixed(2)}`);
  lines.push(`- Save rate: ${(m.saveRate * 100).toFixed(1)}%`);
  lines.push(`- Confidence flag share: ${(m.confidenceFlagShare * 100).toFixed(1)}%`);
  lines.push(`- Error pattern flag share: ${(m.errorPatternFlagShare * 100).toFixed(1)}%`);

  lines.push(``, `## Summary`);
  lines.push(report.summary);

  return lines.join('\n');
}
