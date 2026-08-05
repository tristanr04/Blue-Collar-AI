/**
 * gate-scenarios.ts
 *
 * 22 fixture scenarios for the extraction accuracy gate.
 * All values are fabricated — no real financial data.
 * Used by extraction-gate.test.ts to verify gate behavior across all
 * 8 document categories and error conditions.
 */

import type { FlatFields } from "../../lib/confidence-thresholds.js";

export interface GateScenario {
  id: string;
  description: string;
  docType: string;
  fields: FlatFields;
  /** Expected: should the gate raise blocking flags? */
  expectsBlocking: boolean;
  /** Expected: should the gate raise advisory flags? */
  expectsAdvisory: boolean;
  /** Expected: should the gate be completely clean (no flags)? */
  expectsClean: boolean;
  /** Optional note about what pattern this scenario tests */
  note?: string;
}

// Helper to make a field entry
function f(value: unknown, confidence = 85): { value: unknown; confidence: number } {
  return { value, confidence };
}
function fLow(value: unknown): { value: unknown; confidence: number } {
  return { value, confidence: 40 };
}

// ─── Paystub scenarios ────────────────────────────────────────────────────────

export const SCENARIO_PAYSTUB_CLEAN: GateScenario = {
  id: 'paystub-clean',
  description: 'Clean paystub — all required fields present with good confidence',
  docType: 'Paystub',
  fields: {
    employer:  f('ACME Construction', 90),
    grossPay:  f(2400, 92),
    netPay:    f(1800, 92),
    // Omit individual tax fields to avoid net_pay_mismatch reconciliation.
    // The gate only checks the tax identity when at least one of fed/state/ss/medicare is present.
    payDate:   f('2026-07-25', 90),
  },
  expectsBlocking: false,
  expectsAdvisory: false,
  expectsClean: true,
  note: 'Scenario 1: clean paystub',
};

export const SCENARIO_PAYSTUB_NET_EXCEEDS_GROSS: GateScenario = {
  id: 'paystub-net-exceeds-gross',
  description: 'Net pay is greater than gross pay — sign reversal or wrong field',
  docType: 'Paystub',
  fields: {
    employer: f('ACME Construction', 90),
    grossPay: f(1800, 90),
    netPay:   f(2400, 90),  // ERROR: net > gross
    federalTax: f(360, 88),
    stateTax: f(120, 88),
  },
  expectsBlocking: true,
  expectsAdvisory: false,
  expectsClean: false,
  note: 'Scenario 2: net exceeds gross — blocking reconciliation',
};

export const SCENARIO_PAYSTUB_MISSING_GROSS: GateScenario = {
  id: 'paystub-missing-gross',
  description: 'Gross pay field is absent — required high-impact field',
  docType: 'Paystub',
  fields: {
    employer: f('ACME Construction', 90),
    // grossPay intentionally absent
    netPay: f(1800, 90),
    federalTax: f(360, 88),
  },
  expectsBlocking: true,
  expectsAdvisory: false,
  expectsClean: false,
  note: 'Scenario 3: missing required high-impact field',
};

export const SCENARIO_PAYSTUB_DECIMAL_ERROR: GateScenario = {
  id: 'paystub-decimal-error',
  description: "Gross pay has decimal shift — $2,400 OCR'd as 240000",
  docType: 'Paystub',
  fields: {
    employer:  f('River Plumbing', 90),
    grossPay:  f(240000, 90),  // ERROR: 100x too large
    netPay:    f(1800, 90),
    federalTax: f(360, 88),
  },
  expectsBlocking: false,
  expectsAdvisory: true,
  expectsClean: false,
  note: 'Scenario 4: decimal shift error pattern',
};

export const SCENARIO_PAYSTUB_PERCENTAGE_ERROR: GateScenario = {
  id: 'paystub-percentage-error',
  description: 'Retirement contribution rate entered as 650 instead of 6.5%',
  docType: 'Paystub',
  fields: {
    employer:                 f('River Plumbing', 90),
    grossPay:                 f(2400, 92),
    netPay:                   f(1800, 92),
    employeeContributionRate: f(650, 85),  // ERROR: should be 6.5
  },
  expectsBlocking: false,
  expectsAdvisory: true,
  expectsClean: false,
  note: 'Scenario 5: percentage scaling error',
};

// ─── Banking scenarios ────────────────────────────────────────────────────────

export const SCENARIO_BANKING_CLEAN: GateScenario = {
  id: 'banking-clean',
  description: 'Clean bank statement — balance reconciles',
  docType: 'Checking Account',
  fields: {
    lastFour:       f('4521', 90),
    currentBalance: f(5234.18, 90),
    closingBalance: f(5234.18, 90),
    openingBalance: f(4800.00, 88),
    totalDeposits:  f(1500.00, 88),
    totalWithdrawals: f(1065.82, 88),
    // Use day > 12 to avoid date-format-ambiguous pattern (month=7,day=01 would both be ≤12)
    statementStartDate: f('2026-07-15', 88),
    statementEndDate:   f('2026-07-31', 88),
  },
  expectsBlocking: false,
  expectsAdvisory: false,
  expectsClean: true,
  note: 'Scenario 6: clean bank statement',
};

export const SCENARIO_BANKING_BALANCE_MISMATCH: GateScenario = {
  id: 'banking-balance-mismatch',
  description: "Closing balance doesn't reconcile with opening + deposits - withdrawals",
  docType: 'Bank Statement',
  fields: {
    lastFour:       f('4521', 90),
    currentBalance: f(6500.00, 90),  // ERROR: should be ~5234.18
    closingBalance: f(6500.00, 90),
    openingBalance: f(4800.00, 88),
    totalDeposits:  f(1500.00, 88),
    totalWithdrawals: f(1065.82, 88),
  },
  expectsBlocking: false,
  expectsAdvisory: true,
  expectsClean: false,
  note: 'Scenario 7: balance reconciliation mismatch',
};

export const SCENARIO_BANKING_PERIOD_CONFLICT: GateScenario = {
  id: 'banking-period-conflict',
  description: 'Statement end date before start date — likely date format error',
  docType: 'Savings Account',
  fields: {
    lastFour:           f('1234', 90),
    currentBalance:     f(12000, 90),
    statementStartDate: f('2026-07-31', 88),  // ERROR: end before start
    statementEndDate:   f('2026-07-01', 88),
  },
  expectsBlocking: false,
  expectsAdvisory: true,
  expectsClean: false,
  note: 'Scenario 8: statement period conflict',
};

// ─── Credit Card scenarios ────────────────────────────────────────────────────

export const SCENARIO_CREDIT_CARD_CLEAN: GateScenario = {
  id: 'credit-card-clean',
  description: 'Clean credit card statement — all fields present and reconciled',
  docType: 'Credit Card',
  fields: {
    lastFour:        f('9876', 90),
    currentBalance:  f(1250.00, 92),
    creditLimit:     f(5000.00, 90),
    availableCredit: f(3750.00, 90),
    apr:             f(19.99, 88),
    minimumPayment:  f(25.00, 88),
    dueDate:         f('2026-08-15', 88),
  },
  expectsBlocking: false,
  expectsAdvisory: false,
  expectsClean: true,
  note: 'Scenario 9: clean credit card',
};

export const SCENARIO_CREDIT_CARD_BALANCE_EXCEEDS_LIMIT: GateScenario = {
  id: 'credit-card-over-limit',
  description: 'Balance exceeds credit limit — possible OCR error or over-limit fee',
  docType: 'Credit Card Statement',
  fields: {
    lastFour:       f('9876', 90),
    currentBalance: f(6200.00, 90),  // ERROR: exceeds limit
    creditLimit:    f(5000.00, 90),
    apr:            f(19.99, 88),
  },
  expectsBlocking: true,
  expectsAdvisory: false,
  expectsClean: false,
  note: 'Scenario 10: balance exceeds credit limit',
};

export const SCENARIO_CREDIT_CARD_OCR_SUBSTITUTION: GateScenario = {
  id: 'credit-card-ocr-lastfour',
  description: 'Account last four contains OCR substitution — O for 0',
  docType: 'Credit Card',
  fields: {
    lastFour:       f('9O76', 90),  // ERROR: O instead of 0
    currentBalance: f(1250.00, 90),
    creditLimit:    f(5000.00, 90),
    apr:            f(19.99, 88),
  },
  expectsBlocking: false,
  expectsAdvisory: true,
  expectsClean: false,
  note: 'Scenario 11: OCR O→0 substitution',
};

export const SCENARIO_CREDIT_CARD_DATE_AMBIGUOUS: GateScenario = {
  id: 'credit-card-date-ambiguous',
  description: 'Due date is ambiguous — month and day could be swapped',
  docType: 'Credit Card',
  fields: {
    lastFour:       f('4321', 90),
    currentBalance: f(500, 90),
    apr:            f(18.99, 88),
    dueDate:        f('2026-08-07', 88),  // ambiguous: Aug 7 or Jul 8?
  },
  expectsBlocking: false,
  expectsAdvisory: true,
  expectsClean: false,
  note: 'Scenario 12: ambiguous date',
};

// ─── Loan scenarios ────────────────────────────────────────────────────────────

export const SCENARIO_LOAN_CLEAN: GateScenario = {
  id: 'loan-clean',
  description: 'Clean auto loan statement',
  docType: 'Auto Loan',
  fields: {
    lastFour:       f('5678', 90),
    currentBalance: f(18500.00, 90),
    apr:            f(6.99, 88),
    monthlyPayment: f(372.00, 88),
    // Use day > 12 to avoid date-format-ambiguous (month=8, day=01 both ≤12)
    nextDueDate:    f('2026-08-15', 88),
  },
  expectsBlocking: false,
  expectsAdvisory: false,
  expectsClean: true,
  note: 'Scenario 13: clean auto loan',
};

export const SCENARIO_LOAN_SIGN_ERROR: GateScenario = {
  id: 'loan-sign-error',
  description: 'Original loan amount is negative — sign reversal',
  docType: 'Personal Loan',
  fields: {
    currentBalance:  f(8000, 90),
    originalAmount:  f(-25000, 90),  // ERROR: negative
    apr:             f(12.5, 88),
    monthlyPayment:  f(450, 88),
  },
  expectsBlocking: false,
  expectsAdvisory: true,
  expectsClean: false,
  note: 'Scenario 14: sign reversal error pattern',
};

// ─── Mortgage scenarios ────────────────────────────────────────────────────────

export const SCENARIO_MORTGAGE_CLEAN: GateScenario = {
  id: 'mortgage-clean',
  description: 'Clean mortgage statement — P&I + escrow ≈ monthly payment',
  docType: 'Mortgage',
  fields: {
    principalBalance:     f(285000, 90),
    originalLoanAmount:   f(320000, 88),
    interestRate:         f(6.75, 90),
    monthlyPayment:       f(2078, 90),
    principalAndInterest: f(1748, 88),
    escrowAmount:         f(330, 88),
    // Use day > 12 to avoid date-format-ambiguous (month=8, day=01 both ≤12)
    nextDueDate:          f('2026-08-15', 88),
  },
  expectsBlocking: false,
  expectsAdvisory: false,
  expectsClean: true,
  note: 'Scenario 15: clean mortgage',
};

export const SCENARIO_MORTGAGE_PAYMENT_MISMATCH: GateScenario = {
  id: 'mortgage-payment-mismatch',
  description: "P&I + escrow doesn't add up to monthly payment",
  docType: 'Mortgage',
  fields: {
    principalBalance:     f(285000, 90),
    interestRate:         f(6.75, 90),
    monthlyPayment:       f(2078, 90),
    principalAndInterest: f(1000, 88),  // ERROR: too low
    escrowAmount:         f(330, 88),   // 1000 + 330 = 1330 ≠ 2078
  },
  expectsBlocking: false,
  expectsAdvisory: true,
  expectsClean: false,
  note: 'Scenario 16: payment component mismatch',
};

// ─── Brokerage scenarios ──────────────────────────────────────────────────────

export const SCENARIO_BROKERAGE_CLEAN: GateScenario = {
  id: 'brokerage-clean',
  description: 'Clean brokerage statement — total ≈ securities + cash',
  docType: 'Brokerage Account',
  fields: {
    lastFour:       f('3344', 90),
    totalValue:     f(42500, 90),
    securitiesValue: f(40000, 88),
    cashBalance:    f(2500, 88),
    statementDate:  f('2026-07-31', 88),
  },
  expectsBlocking: false,
  expectsAdvisory: false,
  expectsClean: true,
  note: 'Scenario 17: clean brokerage',
};

// ─── Retirement scenarios ─────────────────────────────────────────────────────

export const SCENARIO_RETIREMENT_CLEAN: GateScenario = {
  id: 'retirement-clean',
  description: 'Clean 401(k) statement',
  docType: '401(k)',
  fields: {
    currentBalance:  f(87500, 90),
    vestedBalance:   f(75000, 88),  // < currentBalance ✓
    planName:        f('401(k) Savings Plan', 88),
    lastFour:        f('1122', 90),
    statementDate:   f('2026-06-30', 88),
  },
  expectsBlocking: false,
  expectsAdvisory: false,
  expectsClean: true,
  note: 'Scenario 18: clean retirement account',
};

export const SCENARIO_RETIREMENT_VESTED_EXCEEDS_TOTAL: GateScenario = {
  id: 'retirement-vested-exceeds-total',
  description: 'Vested balance greater than total balance — impossible',
  docType: '401(k)',
  fields: {
    currentBalance: f(75000, 90),
    vestedBalance:  f(87500, 88),  // ERROR: vested > total
    planName:       f('401(k) Savings Plan', 88),
  },
  expectsBlocking: false,
  expectsAdvisory: true,
  expectsClean: false,
  note: 'Scenario 19: vested exceeds total',
};

// ─── Bill scenarios ────────────────────────────────────────────────────────────

export const SCENARIO_BILL_CLEAN: GateScenario = {
  id: 'bill-clean',
  description: 'Clean utility bill',
  docType: 'Utility Bill',
  fields: {
    provider:  f('City Power & Light', 90),
    amountDue: f(142.50, 90),
    dueDate:   f('2026-08-20', 88),
  },
  expectsBlocking: false,
  expectsAdvisory: false,
  expectsClean: true,
  note: 'Scenario 20: clean bill',
};

export const SCENARIO_BILL_MISSING_AMOUNT: GateScenario = {
  id: 'bill-missing-amount',
  description: 'Amount due field is absent — required high-impact field',
  docType: 'Monthly Bill',
  fields: {
    provider: f('Internet Co.', 90),
    // amountDue intentionally absent
    dueDate: f('2026-08-15', 88),
  },
  expectsBlocking: true,
  expectsAdvisory: false,
  expectsClean: false,
  note: 'Scenario 21: missing required field',
};

export const SCENARIO_BILL_MISSING_PROVIDER: GateScenario = {
  id: 'bill-missing-provider',
  description: 'Provider name absent — required field for bill matching (advisory, not blocking)',
  docType: 'Utility Bill',
  fields: {
    // provider intentionally absent
    amountDue: f(85.00, 90),
    // Use day > 12 to avoid date-format-ambiguous on dueDate
    dueDate: f('2026-08-20', 88),
  },
  // Provider has highImpact:false → missing required field → advisory, not blocking
  expectsBlocking: false,
  expectsAdvisory: true,
  expectsClean: false,
  note: 'Scenario 22: missing provider (required non-high-impact → advisory)',
};

// ─── All scenarios array ──────────────────────────────────────────────────────

export const ALL_GATE_SCENARIOS: GateScenario[] = [
  SCENARIO_PAYSTUB_CLEAN,
  SCENARIO_PAYSTUB_NET_EXCEEDS_GROSS,
  SCENARIO_PAYSTUB_MISSING_GROSS,
  SCENARIO_PAYSTUB_DECIMAL_ERROR,
  SCENARIO_PAYSTUB_PERCENTAGE_ERROR,
  SCENARIO_BANKING_CLEAN,
  SCENARIO_BANKING_BALANCE_MISMATCH,
  SCENARIO_BANKING_PERIOD_CONFLICT,
  SCENARIO_CREDIT_CARD_CLEAN,
  SCENARIO_CREDIT_CARD_BALANCE_EXCEEDS_LIMIT,
  SCENARIO_CREDIT_CARD_OCR_SUBSTITUTION,
  SCENARIO_CREDIT_CARD_DATE_AMBIGUOUS,
  SCENARIO_LOAN_CLEAN,
  SCENARIO_LOAN_SIGN_ERROR,
  SCENARIO_MORTGAGE_CLEAN,
  SCENARIO_MORTGAGE_PAYMENT_MISMATCH,
  SCENARIO_BROKERAGE_CLEAN,
  SCENARIO_RETIREMENT_CLEAN,
  SCENARIO_RETIREMENT_VESTED_EXCEEDS_TOTAL,
  SCENARIO_BILL_CLEAN,
  SCENARIO_BILL_MISSING_AMOUNT,
  SCENARIO_BILL_MISSING_PROVIDER,
];
