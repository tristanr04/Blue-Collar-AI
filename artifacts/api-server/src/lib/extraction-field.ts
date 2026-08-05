/**
 * extraction-field.ts
 *
 * Core types and helpers for the extraction accuracy and reconciliation gate.
 * Every extracted value is wrapped in an ExtractionField that carries provenance
 * (rawValue, userEditedValue, confidence) and accumulated warnings.
 *
 * These are pure, stateless helpers — no side effects, no I/O.
 */

// ─── Warning severity ─────────────────────────────────────────────────────────

/** Blocking warnings must be resolved before the user can save.
 *  Advisory warnings are surfaced for review but never block the save button. */
export type WarningSeverity = 'blocking' | 'advisory';

// ─── FieldWarning ─────────────────────────────────────────────────────────────

export interface FieldWarning {
  /** Short machine-readable code, e.g. 'LOW_CONFIDENCE', 'OCR_O_FOR_0' */
  code: string;
  /** Human-readable explanation shown to the user */
  message: string;
  severity: WarningSeverity;
  /**
   * If we can derive a likely correct value (e.g. percentage-scaling fix),
   * put it here so the UI can offer a one-tap correction.
   */
  suggestedValue?: string;
}

// ─── ExtractionField ─────────────────────────────────────────────────────────

/**
 * Wraps a single extracted field value with full provenance.
 *
 * Invariant: only `userEditedValue` (never `rawValue`) is mutated after
 * construction.  Call `applyUserEdit` to get a new field with the edit applied.
 */
export interface ExtractionField<T = unknown> {
  /** Value as returned by the AI model.  Immutable after construction. */
  rawValue: T | null;
  /**
   * Value set by the user after reviewing a flag.
   * `undefined` means the user has not made an edit.
   */
  userEditedValue?: T;
  /** AI-reported confidence [0-100]. */
  confidence: number;
  /** Accumulated warnings from confidence / reconciliation / error-pattern checks. */
  warnings: FieldWarning[];
}

// ─── Factories ───────────────────────────────────────────────────────────────

export function makeExtractionField<T>(
  rawValue: T | null,
  confidence: number,
): ExtractionField<T> {
  return { rawValue, confidence, warnings: [] };
}

// ─── Accessors ───────────────────────────────────────────────────────────────

/** Return the effective display value: user edit wins over raw AI value. */
export function effectiveValue<T>(field: ExtractionField<T>): T | null {
  return field.userEditedValue !== undefined ? field.userEditedValue : field.rawValue;
}

/** True if the user has explicitly edited this field. */
export function wasEdited<T>(field: ExtractionField<T>): boolean {
  return field.userEditedValue !== undefined;
}

/** True if the field has at least one blocking warning that has not been dismissed. */
export function hasBlockingWarnings<T>(field: ExtractionField<T>): boolean {
  return field.warnings.some(w => w.severity === 'blocking');
}

// ─── Mutations (return new objects; never mutate in place) ────────────────────

/** Return a new field with the user's edit applied. */
export function applyUserEdit<T>(field: ExtractionField<T>, value: T): ExtractionField<T> {
  return { ...field, userEditedValue: value };
}

/** Return a new field with an additional warning appended. */
export function addWarning<T>(field: ExtractionField<T>, warning: FieldWarning): ExtractionField<T> {
  return { ...field, warnings: [...field.warnings, warning] };
}

/** Return a new field with all warnings of a given code removed. */
export function dismissWarning<T>(field: ExtractionField<T>, code: string): ExtractionField<T> {
  return { ...field, warnings: field.warnings.filter(w => w.code !== code) };
}

// ─── Finalise ─────────────────────────────────────────────────────────────────

export interface FinalizedField<T = unknown> {
  value: T | null;
  wasEdited: boolean;
  hasBlockingWarnings: boolean;
  warnings: FieldWarning[];
}

/**
 * Produce an immutable summary of a field ready for persistence or display.
 * Does NOT write to any store — callers decide what to do with the result.
 */
export function finalizeField<T>(field: ExtractionField<T>): FinalizedField<T> {
  return {
    value: effectiveValue(field),
    wasEdited: wasEdited(field),
    hasBlockingWarnings: hasBlockingWarnings(field),
    warnings: field.warnings,
  };
}

// ─── Gate summary types (used by all three gate modules) ─────────────────────

/** A confidence flag produced by checkConfidence(). */
export interface ConfidenceFlag {
  field: string;
  /** Human-readable field label */
  label: string;
  category: string;
  required: boolean;
  /** null means the field was absent entirely */
  actualConfidence: number | null;
  minimumRequired: number;
  severity: WarningSeverity;
  message: string;
}

/** A reconciliation warning produced by reconcile(). */
export interface ReconciliationWarning {
  rule: string;
  fields: string[];
  message: string;
  severity: WarningSeverity;
  /** Signed delta between expected and actual values (if numeric) */
  computedDelta?: number;
}

/** An error-pattern flag produced by detectErrorPatterns(). */
export interface ErrorPatternFlag {
  pattern: string;
  field: string;
  label: string;
  rawValue: string | number | null;
  suggestedValue?: string | number;
  message: string;
  severity: WarningSeverity;
}

/** Combined gate output attached to every scan response. */
export interface GateResult {
  confidenceFlags: ConfidenceFlag[];
  reconciliationWarnings: ReconciliationWarning[];
  errorPatternFlags: ErrorPatternFlag[];
  /** True if any flag or warning has severity = 'blocking' */
  hasBlockingIssues: boolean;
}

export function buildGateResult(
  confidenceFlags: ConfidenceFlag[],
  reconciliationWarnings: ReconciliationWarning[],
  errorPatternFlags: ErrorPatternFlag[],
): GateResult {
  const hasBlockingIssues =
    confidenceFlags.some(f => f.severity === 'blocking') ||
    reconciliationWarnings.some(w => w.severity === 'blocking') ||
    errorPatternFlags.some(f => f.severity === 'blocking');
  return { confidenceFlags, reconciliationWarnings, errorPatternFlags, hasBlockingIssues };
}
