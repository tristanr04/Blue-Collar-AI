/**
 * confidence-thresholds.ts
 *
 * Per-category (Paystub / Banking / Credit Card / Loan / Mortgage / HELOC /
 * Brokerage / Retirement / Bill) required-field definitions with minimum
 * confidence thresholds.
 *
 * High-impact fields (balances, rates, account IDs) have tighter minimums.
 * checkConfidence() maps a flat fields object to a ConfidenceFlag[].
 *
 * Pure, stateless — no I/O.
 */

import type { ConfidenceFlag, WarningSeverity } from "./extraction-field.js";

// ─── Category mapping ─────────────────────────────────────────────────────────

/** Broad category derived from docType string. */
export type FieldCategory =
  | 'Paystub'
  | 'Banking'
  | 'CreditCard'
  | 'Loan'
  | 'Mortgage'
  | 'HELOC'
  | 'Brokerage'
  | 'Retirement'
  | 'Bill'
  | 'Unknown';

const BANKING_DOC_TYPES = new Set([
  'Checking Account', 'Savings Account', 'High-Yield Savings',
  'Money Market Account', 'Certificate of Deposit', 'Cash Management Account',
  'Bank Statement',
]);

const CREDIT_CARD_DOC_TYPES = new Set([
  'Credit Card', 'Credit Card Statement', 'Line of Credit',
]);

const LOAN_DOC_TYPES = new Set([
  'Auto Loan', 'Personal Loan', 'Student Loan',
]);

const BROKERAGE_DOC_TYPES = new Set([
  'Brokerage Account', 'Margin Account', 'Robo-Adviser Account', 'Employee Stock Plan',
]);

const RETIREMENT_DOC_TYPES = new Set([
  '401(k)', 'Roth 401(k)', '403(b)', '457(b)',
  'Traditional IRA', 'Roth IRA', 'SEP IRA', 'SIMPLE IRA', 'Rollover IRA',
  'Pension', 'Thrift Savings Plan', 'HSA Investment Account',
  'Retirement Account', 'Retirement Statement',
]);

const BILL_DOC_TYPES = new Set([
  'Monthly Bill', 'Utility Bill',
]);

export function resolveCategory(docType: string): FieldCategory {
  if (!docType) return 'Unknown';
  if (docType === 'Paystub') return 'Paystub';
  if (BANKING_DOC_TYPES.has(docType)) return 'Banking';
  if (CREDIT_CARD_DOC_TYPES.has(docType)) return 'CreditCard';
  if (LOAN_DOC_TYPES.has(docType)) return 'Loan';
  if (docType === 'Mortgage') return 'Mortgage';
  if (docType === 'HELOC') return 'HELOC';
  if (BROKERAGE_DOC_TYPES.has(docType)) return 'Brokerage';
  if (RETIREMENT_DOC_TYPES.has(docType)) return 'Retirement';
  if (BILL_DOC_TYPES.has(docType)) return 'Bill';
  return 'Unknown';
}

// ─── Field requirement spec ───────────────────────────────────────────────────

interface FieldSpec {
  field: string;
  label: string;
  /** Minimum confidence required if the field IS present. */
  minimumConfidence: number;
  /**
   * When true, an absent field (confidence=null) is flagged as blocking.
   * When false, an absent field is flagged as advisory.
   */
  requiredPresent: boolean;
  /** Tighter minimum → blocking when below; looser → advisory */
  highImpact: boolean;
}

// ─── Category requirement tables ──────────────────────────────────────────────

const PAYSTUB_FIELDS: FieldSpec[] = [
  { field: 'employer',   label: 'Employer name', minimumConfidence: 55, requiredPresent: true,  highImpact: false },
  { field: 'grossPay',   label: 'Gross pay',      minimumConfidence: 70, requiredPresent: true,  highImpact: true  },
  { field: 'netPay',     label: 'Net pay',         minimumConfidence: 70, requiredPresent: true,  highImpact: true  },
  { field: 'payDate',    label: 'Pay date',        minimumConfidence: 60, requiredPresent: false, highImpact: false },
  { field: 'regularHours', label: 'Regular hours', minimumConfidence: 60, requiredPresent: false, highImpact: false },
  { field: 'federalTax', label: 'Federal tax',     minimumConfidence: 60, requiredPresent: false, highImpact: false },
];

const BANKING_FIELDS: FieldSpec[] = [
  { field: 'lastFour',       label: 'Account last four', minimumConfidence: 75, requiredPresent: false, highImpact: true  },
  { field: 'currentBalance', label: 'Current balance',   minimumConfidence: 70, requiredPresent: false, highImpact: true  },
  { field: 'closingBalance', label: 'Closing balance',   minimumConfidence: 70, requiredPresent: false, highImpact: true  },
];

const CREDIT_CARD_FIELDS: FieldSpec[] = [
  { field: 'lastFour',        label: 'Account last four', minimumConfidence: 75, requiredPresent: false, highImpact: true  },
  { field: 'currentBalance',  label: 'Current balance',   minimumConfidence: 70, requiredPresent: true,  highImpact: true  },
  { field: 'creditLimit',     label: 'Credit limit',      minimumConfidence: 70, requiredPresent: false, highImpact: true  },
  { field: 'apr',             label: 'APR',               minimumConfidence: 65, requiredPresent: false, highImpact: true  },
  { field: 'minimumPayment',  label: 'Minimum payment',   minimumConfidence: 65, requiredPresent: false, highImpact: true  },
  { field: 'dueDate',         label: 'Payment due date',  minimumConfidence: 60, requiredPresent: false, highImpact: false },
];

const LOAN_FIELDS: FieldSpec[] = [
  { field: 'currentBalance',    label: 'Current balance',     minimumConfidence: 70, requiredPresent: true,  highImpact: true  },
  { field: 'apr',               label: 'Interest rate / APR', minimumConfidence: 65, requiredPresent: false, highImpact: true  },
  { field: 'monthlyPayment',    label: 'Monthly payment',     minimumConfidence: 65, requiredPresent: false, highImpact: true  },
  { field: 'lastFour',          label: 'Account last four',   minimumConfidence: 75, requiredPresent: false, highImpact: true  },
  { field: 'nextDueDate',       label: 'Next due date',       minimumConfidence: 60, requiredPresent: false, highImpact: false },
];

const MORTGAGE_FIELDS: FieldSpec[] = [
  { field: 'principalBalance',   label: 'Principal balance',  minimumConfidence: 70, requiredPresent: true,  highImpact: true  },
  { field: 'interestRate',       label: 'Interest rate',      minimumConfidence: 65, requiredPresent: true,  highImpact: true  },
  { field: 'monthlyPayment',     label: 'Monthly payment',    minimumConfidence: 65, requiredPresent: false, highImpact: true  },
  { field: 'lender',             label: 'Lender name',        minimumConfidence: 55, requiredPresent: false, highImpact: false },
  { field: 'nextDueDate',        label: 'Next due date',      minimumConfidence: 60, requiredPresent: false, highImpact: false },
];

const HELOC_FIELDS: FieldSpec[] = [
  { field: 'currentBalance',  label: 'Current balance',    minimumConfidence: 70, requiredPresent: true,  highImpact: true  },
  { field: 'creditLimit',     label: 'Credit limit',       minimumConfidence: 70, requiredPresent: true,  highImpact: true  },
  { field: 'interestRate',    label: 'Interest rate',      minimumConfidence: 65, requiredPresent: false, highImpact: true  },
];

const BROKERAGE_FIELDS: FieldSpec[] = [
  { field: 'totalValue',    label: 'Total account value', minimumConfidence: 70, requiredPresent: true,  highImpact: true  },
  { field: 'lastFour',      label: 'Account last four',  minimumConfidence: 75, requiredPresent: false, highImpact: true  },
];

const RETIREMENT_FIELDS: FieldSpec[] = [
  { field: 'currentBalance', label: 'Account balance',     minimumConfidence: 70, requiredPresent: true,  highImpact: true  },
  { field: 'planName',       label: 'Plan name',           minimumConfidence: 55, requiredPresent: false, highImpact: false },
  { field: 'lastFour',       label: 'Account last four',   minimumConfidence: 75, requiredPresent: false, highImpact: true  },
];

const BILL_FIELDS: FieldSpec[] = [
  { field: 'amountDue',   label: 'Amount due',    minimumConfidence: 70, requiredPresent: true,  highImpact: true  },
  { field: 'provider',    label: 'Provider name', minimumConfidence: 55, requiredPresent: true,  highImpact: false },
  { field: 'dueDate',     label: 'Due date',      minimumConfidence: 60, requiredPresent: false, highImpact: false },
];

const CATEGORY_FIELD_SPECS: Record<FieldCategory, FieldSpec[]> = {
  Paystub:    PAYSTUB_FIELDS,
  Banking:    BANKING_FIELDS,
  CreditCard: CREDIT_CARD_FIELDS,
  Loan:       LOAN_FIELDS,
  Mortgage:   MORTGAGE_FIELDS,
  HELOC:      HELOC_FIELDS,
  Brokerage:  BROKERAGE_FIELDS,
  Retirement: RETIREMENT_FIELDS,
  Bill:       BILL_FIELDS,
  Unknown:    [],
};

// ─── checkConfidence ─────────────────────────────────────────────────────────

/** Flat field shape accepted by the gate (matches both Zod schema and fast-path shapes). */
export type FlatFields = Record<string, { value?: unknown; confidence?: number } | null | undefined>;

/**
 * Check every category-required field's presence and confidence.
 * Returns a ConfidenceFlag[] — empty means everything is within spec.
 */
export function checkConfidence(
  docType: string,
  fields: FlatFields,
): ConfidenceFlag[] {
  const category = resolveCategory(docType);
  const specs = CATEGORY_FIELD_SPECS[category];
  if (specs.length === 0) return [];

  const flags: ConfidenceFlag[] = [];

  for (const spec of specs) {
    const entry = fields[spec.field];
    const value = entry?.value;
    const confidence = typeof entry?.confidence === 'number' ? entry.confidence : null;

    const isAbsent =
      entry == null ||
      value == null ||
      value === '' ||
      value === 'null';

    if (isAbsent) {
      // Missing field
      if (!spec.requiredPresent) continue; // optional — skip
      const severity: WarningSeverity = spec.highImpact ? 'blocking' : 'advisory';
      flags.push({
        field: spec.field,
        label: spec.label,
        category,
        required: true,
        actualConfidence: null,
        minimumRequired: spec.minimumConfidence,
        severity,
        message: `"${spec.label}" is required but was not found in the document.`,
      });
      continue;
    }

    // Present but low confidence
    if (confidence !== null && confidence < spec.minimumConfidence) {
      const severity: WarningSeverity = spec.highImpact && confidence < spec.minimumConfidence - 15
        ? 'blocking'
        : 'advisory';
      flags.push({
        field: spec.field,
        label: spec.label,
        category,
        required: spec.requiredPresent,
        actualConfidence: confidence,
        minimumRequired: spec.minimumConfidence,
        severity,
        message: `"${spec.label}" was extracted with low confidence (${confidence}%). Please verify the value.`,
      });
    }
  }

  return flags;
}
