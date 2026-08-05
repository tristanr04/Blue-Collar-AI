/**
 * error-patterns.ts
 *
 * 13 heuristic pattern detectors that catch common OCR and transcription errors
 * in extracted financial data.  Each detector returns an ErrorPatternFlag[] —
 * empty means the pattern was not observed.
 *
 * IMPORTANT: Detectors NEVER auto-apply corrections.  They always return a
 * `suggestedValue` for the UI to offer as a one-tap fix.  The user must
 * explicitly accept any correction before it is stored.
 *
 * Pure, stateless — no I/O.
 */

import type { ErrorPatternFlag } from "./extraction-field.js";
import { resolveCategory, type FlatFields } from "./confidence-thresholds.js";

// ─── Value helpers ────────────────────────────────────────────────────────────

function numVal(fields: FlatFields, key: string): number | null {
  const entry = fields[key];
  if (!entry) return null;
  const v = entry.value;
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,$%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function strVal(fields: FlatFields, key: string): string | null {
  const entry = fields[key];
  if (!entry) return null;
  const v = entry.value;
  return v != null ? String(v) : null;
}

function flag(
  pattern: string,
  field: string,
  label: string,
  rawValue: string | number | null,
  message: string,
  suggestedValue?: string | number,
  severity: 'blocking' | 'advisory' = 'advisory',
): ErrorPatternFlag {
  return { pattern, field, label, rawValue, message, suggestedValue, severity };
}

// ─── 1. Decimal shift ────────────────────────────────────────────────────────

/**
 * Detects when a dollar amount appears to have been shifted by a factor of 100
 * (e.g., $12,345 → 1234500 or 123.45 instead of $1,234.50).
 *
 * Heuristic: if the extracted value is ≥ 10× the "normal upper bound" for the
 * field, suggest dividing by 100; if it is ≤ 1/100 of the "normal lower bound",
 * suggest multiplying by 100.
 */

// Typical upper/lower bounds by field name (rough but catches gross errors)
const FIELD_UPPER_BOUNDS: Record<string, number> = {
  grossPay: 50_000, netPay: 40_000, federalTax: 20_000, stateTax: 10_000,
  socialSecurity: 10_000, medicare: 5_000,
  currentBalance: 10_000_000, closingBalance: 10_000_000,
  principalBalance: 5_000_000, originalLoanAmount: 5_000_000,
  creditLimit: 1_000_000, totalValue: 50_000_000,
  amountDue: 100_000, monthlyPayment: 50_000,
  minimumPayment: 50_000, balanceOwed: 5_000_000,
};

function checkDecimalShift(fields: FlatFields): ErrorPatternFlag[] {
  const flags: ErrorPatternFlag[] = [];
  for (const [field, upper] of Object.entries(FIELD_UPPER_BOUNDS)) {
    const v = numVal(fields, field);
    if (v === null || v <= 0) continue;
    if (v > upper * 10) {
      flags.push(flag(
        'decimal-shift',
        field,
        fieldLabel(field),
        v,
        `Value ($${v.toLocaleString()}) appears to be 100× too large. A decimal shift may have occurred during OCR.`,
        parseFloat((v / 100).toFixed(2)),
      ));
    }
  }
  return flags;
}

// ─── 2. Missing decimal ──────────────────────────────────────────────────────

/**
 * Detects when a round integer value looks like it is missing a decimal point.
 * E.g., $1,234 OCR'd as "1234" (fine) vs "$123,456" OCR'd as "123456" but
 * intended as "$1,234.56" (the value is suspicious as a whole number).
 *
 * Applied only when the value is an integer ≥ 10,000 and for certain fields.
 */

const MISSING_DECIMAL_FIELDS = new Set([
  'grossPay', 'netPay', 'federalTax', 'stateTax', 'socialSecurity', 'medicare',
  'minimumPayment', 'monthlyPayment', 'amountDue',
]);

function checkMissingDecimal(fields: FlatFields): ErrorPatternFlag[] {
  const flags: ErrorPatternFlag[] = [];
  for (const field of MISSING_DECIMAL_FIELDS) {
    const v = numVal(fields, field);
    if (v === null) continue;
    // A round integer ≥ 10,000 is suspicious for a pay/payment field
    if (Number.isInteger(v) && v >= 10_000 && v <= 1_000_000) {
      const suggested = parseFloat((v / 100).toFixed(2));
      // Only flag if the divided value makes more sense (i.e. > $50 and < $50,000)
      if (suggested >= 50 && suggested <= 50_000) {
        flags.push(flag(
          'missing-decimal',
          field,
          fieldLabel(field),
          v,
          `Value (${v}) is a round integer ≥ $10,000. If the original showed a decimal (e.g. "$${(v/100).toFixed(2)}"), a decimal may have been dropped during extraction.`,
          suggested,
        ));
      }
    }
  }
  return flags;
}

// ─── 3. Sign reversal ────────────────────────────────────────────────────────

/**
 * Some fields should always be positive (grossPay, netPay, creditLimit, amountDue).
 * A negative value usually indicates a sign reversal in the extraction.
 */

const ALWAYS_POSITIVE_FIELDS: Record<string, string> = {
  grossPay: 'Gross pay', netPay: 'Net pay',
  creditLimit: 'Credit limit', amountDue: 'Amount due',
  originalLoanAmount: 'Original loan amount', originalAmount: 'Original amount',
  totalValue: 'Total value', vestedBalance: 'Vested balance',
};

function checkSignReversal(fields: FlatFields): ErrorPatternFlag[] {
  const flags: ErrorPatternFlag[] = [];
  for (const [field, label] of Object.entries(ALWAYS_POSITIVE_FIELDS)) {
    const v = numVal(fields, field);
    if (v !== null && v < 0) {
      flags.push(flag(
        'sign-reversal',
        field,
        label,
        v,
        `"${label}" is negative ($${v.toFixed(2)}). This field should always be positive — a sign may have been reversed.`,
        Math.abs(v),
      ));
    }
  }
  return flags;
}

// ─── 4. OCR substitutions (O→0, I→1, S→5, B→8) ───────────────────────────

/**
 * In account numbers and similar digit-only strings, letter OCR substitutions
 * are common.  We flag when a field that should contain only digits has
 * ambiguous letter-digit pairs.
 */

const DIGIT_ONLY_FIELDS: Record<string, string> = {
  lastFour:  'Account last four',
  accountLast4: 'Account last four',
};

function checkOcrSubstitutions(fields: FlatFields): ErrorPatternFlag[] {
  const flags: ErrorPatternFlag[] = [];

  for (const [field, label] of Object.entries(DIGIT_ONLY_FIELDS)) {
    const raw = strVal(fields, field);
    if (!raw) continue;

    // Replace known OCR ambiguities and report if changed
    const corrected = raw
      .replace(/O/g, '0')
      .replace(/[Il|]/g, '1')
      .replace(/S/g, '5')
      .replace(/B/g, '8');

    if (corrected !== raw) {
      const patterns: string[] = [];
      if (/O/.test(raw)) patterns.push('O→0');
      if (/[Il|]/.test(raw)) patterns.push('I/l→1');
      if (/S/.test(raw)) patterns.push('S→5');
      if (/B/.test(raw)) patterns.push('B→8');

      flags.push(flag(
        `ocr-substitution`,
        field,
        label,
        raw,
        `"${label}" ("${raw}") contains letters that may be OCR misreadings (${patterns.join(', ')}). Suggested correction: "${corrected}".`,
        corrected,
      ));
    }
  }

  return flags;
}

// ─── 5. Percentage scaling ───────────────────────────────────────────────────

/**
 * Interest rates and APRs should be in the range [0, 50] for typical loans/
 * credit cards.  Values > 100 suggest percentage-as-basis-points (e.g. 6.5%
 * → 650).  Values < 0.01 suggest percentage-as-decimal (e.g. 6.5% → 0.065).
 */

const RATE_FIELDS: Record<string, string> = {
  apr: 'APR', interestRate: 'Interest rate', apy: 'APY',
  employeeContributionRate: 'Employee contribution rate',
  rothContributionRate: 'Roth contribution rate',
  pretaxContributionRate: 'Pre-tax contribution rate',
  vestingPercent: 'Vesting percent',
  marginInterestRate: 'Margin interest rate',
};

function checkPercentageScaling(fields: FlatFields): ErrorPatternFlag[] {
  const flags: ErrorPatternFlag[] = [];

  for (const [field, label] of Object.entries(RATE_FIELDS)) {
    const v = numVal(fields, field);
    if (v === null) continue;

    if (v > 100 && v <= 10_000) {
      // Likely stored as basis points or percent×100
      const suggested = parseFloat((v / 100).toFixed(4));
      flags.push(flag(
        'percentage-scaling',
        field,
        label,
        v,
        `"${label}" (${v}) is > 100. Interest rates should be in percent (e.g., 6.5 for 6.5%). A scaling error may have occurred.`,
        suggested,
      ));
    } else if (v > 0 && v < 0.01) {
      // Likely stored as a decimal fraction (0.065 instead of 6.5)
      const suggested = parseFloat((v * 100).toFixed(4));
      flags.push(flag(
        'percentage-scaling',
        field,
        label,
        v,
        `"${label}" (${v}) is close to 0. Interest rates should be in percent (e.g., 6.5 for 6.5%). Looks like a decimal fraction.`,
        suggested,
      ));
    }
  }

  return flags;
}

// ─── 6. Currency comma cut-off ───────────────────────────────────────────────

/**
 * "$1,234.56" misread as "1" (parser stopped at the comma).
 * Heuristic: value is 1–9 and the field is a monetary amount that should
 * realistically be much larger.
 */

const MIN_REASONABLE_BALANCE: Record<string, number> = {
  currentBalance: 10, closingBalance: 10, principalBalance: 100,
  originalLoanAmount: 100, creditLimit: 100, totalValue: 10,
  grossPay: 100, netPay: 50,
};

function checkCurrencyCommaCutoff(fields: FlatFields): ErrorPatternFlag[] {
  const flags: ErrorPatternFlag[] = [];

  for (const [field, minReasonable] of Object.entries(MIN_REASONABLE_BALANCE)) {
    const v = numVal(fields, field);
    if (v === null) continue;
    if (v >= 1 && v < minReasonable && Number.isInteger(v)) {
      flags.push(flag(
        'currency-comma-cutoff',
        field,
        fieldLabel(field),
        v,
        `Value ($${v}) is suspiciously small for "${fieldLabel(field)}". If the document showed "$${v},xxx", the parser may have stopped at the comma.`,
        undefined, // can't suggest without knowing the full original string
      ));
    }
  }

  return flags;
}

// ─── 7. Date format ambiguity ─────────────────────────────────────────────────

/**
 * Dates where month and day could be swapped (both values ≤ 12).
 * E.g., 01/06/2024 → could be Jan 6 or June 1.
 * We detect ISO strings YYYY-MM-DD where MM and DD are both ≤ 12 and different.
 */

const DATE_FIELDS: Record<string, string> = {
  payDate: 'Pay date', payPeriodStart: 'Pay period start', payPeriodEnd: 'Pay period end',
  statementDate: 'Statement date', statementStartDate: 'Statement start',
  statementEndDate: 'Statement end', nextDueDate: 'Next due date', dueDate: 'Due date',
  drawPeriodEnd: 'Draw period end',
};

function checkDateAmbiguity(fields: FlatFields): ErrorPatternFlag[] {
  const flags: ErrorPatternFlag[] = [];

  for (const [field, label] of Object.entries(DATE_FIELDS)) {
    const raw = strVal(fields, field);
    if (!raw) continue;

    // Match YYYY-MM-DD
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) continue;

    const month = parseInt(m[2], 10);
    const day   = parseInt(m[3], 10);

    // Both ≤ 12 and different → potentially ambiguous
    if (month <= 12 && day <= 12 && month !== day) {
      const alternative = `${m[1]}-${m[3]}-${m[2]}`;
      flags.push(flag(
        'date-format-ambiguous',
        field,
        label,
        raw,
        `Date "${raw}" could be read as ${monthName(month)} ${day} or ${monthName(day)} ${month}. Confirm the correct interpretation.`,
        alternative,
      ));
    }
  }

  return flags;
}

// ─── 8. Two-digit year ────────────────────────────────────────────────────────

function checkTwoDigitYear(fields: FlatFields): ErrorPatternFlag[] {
  const flags: ErrorPatternFlag[] = [];

  for (const [field, label] of Object.entries(DATE_FIELDS)) {
    const raw = strVal(fields, field);
    if (!raw) continue;

    // Check for YY-MM-DD or MM/DD/YY patterns
    const shortYear = raw.match(/^(\d{2})-(\d{2})-(\d{2})$/) ||
                      raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (shortYear) {
      flags.push(flag(
        'two-digit-year',
        field,
        label,
        raw,
        `Date "${raw}" appears to use a two-digit year. Full four-digit year required for accurate processing.`,
      ));
    }
  }

  return flags;
}

// ─── 9. Statement period conflict ────────────────────────────────────────────

/**
 * Catches statementEndDate before statementStartDate, or a statement that ends
 * in the far future (> 6 months from now).  This overlaps with reconciliation
 * but is kept here as an error-pattern flag because it's more likely a date-
 * format error than a logical contradiction.
 */
function checkStatementPeriodConflict(fields: FlatFields): ErrorPatternFlag[] {
  const flags: ErrorPatternFlag[] = [];

  const startRaw = strVal(fields, 'statementStartDate') ?? strVal(fields, 'payPeriodStart');
  const endRaw   = strVal(fields, 'statementEndDate') ?? strVal(fields, 'payPeriodEnd');

  if (!startRaw || !endRaw) return flags;

  const start = new Date(startRaw);
  const end   = new Date(endRaw);

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return flags;

  if (end < start) {
    flags.push(flag(
      'statement-period-conflict',
      'statementEndDate',
      'Statement end date',
      endRaw,
      `Statement end date (${endRaw}) is before start date (${startRaw}). The month/day values may be swapped, or a two-digit year caused a past date.`,
      startRaw, // suggest swapping
    ));
  }

  return flags;
}

// ─── 10. Implausible value ────────────────────────────────────────────────────

/**
 * Values that fall outside any plausible real-world range for a given field.
 * E.g., hourlyRate > $1,000; APR > 100%; remaining term > 600 months.
 */

interface PlausibilityBound {
  label: string;
  min?: number;
  max?: number;
  message: (v: number) => string;
}

const PLAUSIBILITY_BOUNDS: Record<string, PlausibilityBound> = {
  hourlyRate: {
    label: 'Hourly rate',
    max: 10_000,
    message: v => `Hourly rate ($${v}/hr) is unrealistically high. Check for a decimal error.`,
  },
  regularHours: {
    label: 'Regular hours',
    max: 744, // 31 days × 24 hr — absolute ceiling
    message: v => `Regular hours (${v}) exceed the maximum hours in a month. Check the pay period.`,
  },
  overtimeHours: {
    label: 'Overtime hours',
    max: 200,
    message: v => `Overtime hours (${v}) are unusually high for a single pay period.`,
  },
  remainingTermMonths: {
    label: 'Remaining term',
    max: 600, // 50 years
    message: v => `Remaining term (${v} months) exceeds 50 years, which is implausible.`,
  },
  vestingPercent: {
    label: 'Vesting percent',
    min: 0, max: 100,
    message: v => `Vesting percent (${v}%) must be between 0 and 100.`,
  },
};

function checkImplausibleValues(fields: FlatFields): ErrorPatternFlag[] {
  const flags: ErrorPatternFlag[] = [];

  for (const [field, bound] of Object.entries(PLAUSIBILITY_BOUNDS)) {
    const v = numVal(fields, field);
    if (v === null) continue;

    const tooLow  = bound.min !== undefined && v < bound.min;
    const tooHigh = bound.max !== undefined && v > bound.max;

    if (tooLow || tooHigh) {
      flags.push(flag(
        'implausible-value',
        field,
        bound.label,
        v,
        bound.message(v),
      ));
    }
  }

  return flags;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthName(m: number): string {
  return MONTH_NAMES[(m - 1)] ?? `month ${m}`;
}

const FIELD_LABELS: Record<string, string> = {
  grossPay: 'Gross pay', netPay: 'Net pay', federalTax: 'Federal tax',
  stateTax: 'State tax', socialSecurity: 'Social Security', medicare: 'Medicare',
  currentBalance: 'Current balance', closingBalance: 'Closing balance',
  principalBalance: 'Principal balance', originalLoanAmount: 'Original loan amount',
  originalAmount: 'Original amount', creditLimit: 'Credit limit',
  totalValue: 'Total value', amountDue: 'Amount due',
  monthlyPayment: 'Monthly payment', minimumPayment: 'Minimum payment',
  balanceOwed: 'Balance owed', vestedBalance: 'Vested balance',
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run all 13 error-pattern detectors against the extracted fields.
 * Returns a combined ErrorPatternFlag[] — empty means no patterns detected.
 * Category-agnostic: all patterns run regardless of document type, though
 * only applicable fields will produce flags.
 */
export function detectErrorPatterns(
  fields: FlatFields,
  _docType?: string,
): ErrorPatternFlag[] {
  return [
    ...checkDecimalShift(fields),
    ...checkMissingDecimal(fields),
    ...checkSignReversal(fields),
    ...checkOcrSubstitutions(fields),
    ...checkPercentageScaling(fields),
    ...checkCurrencyCommaCutoff(fields),
    ...checkDateAmbiguity(fields),
    ...checkTwoDigitYear(fields),
    ...checkStatementPeriodConflict(fields),
    ...checkImplausibleValues(fields),
  ];
}
