/**
 * reconciliation.ts
 *
 * Pure cross-field consistency checks per document category.
 * reconcile(docType, fields) returns a ReconciliationWarning[].
 *
 * Currency tolerance: ±$0.02 OR ±0.5% (whichever is larger) for sums.
 * All checks are advisory except the most egregious balance violations.
 *
 * Pure, stateless — no I/O.
 */

import type { ReconciliationWarning } from "./extraction-field.js";
import { resolveCategory, type FlatFields } from "./confidence-thresholds.js";

// ─── Value helpers ────────────────────────────────────────────────────────────

function num(fields: FlatFields, key: string): number | null {
  const entry = fields[key];
  if (!entry) return null;
  const v = entry.value;
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** True when |a - b| <= max(absoluteTolerance, |a| * relativeTolerance) */
function withinTolerance(
  a: number,
  b: number,
  absoluteTolerance = 0.02,
  relativeTolerance = 0.005,
): boolean {
  const delta = Math.abs(a - b);
  const threshold = Math.max(absoluteTolerance, Math.abs(a) * relativeTolerance);
  return delta <= threshold;
}

function buildWarn(
  rule: string,
  fields: string[],
  message: string,
  severity: 'blocking' | 'advisory',
  computedDelta?: number,
): ReconciliationWarning {
  return { rule, fields, message, severity, computedDelta };
}

// ─── Category reconcilers ─────────────────────────────────────────────────────

function reconcilePaystub(fields: FlatFields): ReconciliationWarning[] {
  const warnings: ReconciliationWarning[] = [];

  const gross  = num(fields, 'grossPay');
  const net    = num(fields, 'netPay');
  const fed    = num(fields, 'federalTax') ?? 0;
  const state  = num(fields, 'stateTax') ?? 0;
  const ss     = num(fields, 'socialSecurity') ?? 0;
  const mcare  = num(fields, 'medicare') ?? 0;
  const union  = num(fields, 'unionDues') ?? 0;
  const ins    = num(fields, 'insuranceDeductions') ?? 0;
  const retire = num(fields, 'retirementContribution') ?? 0;
  const other  = num(fields, 'otherDeductions') ?? 0;

  if (gross !== null && net !== null) {
    // Net must be strictly less than gross (unless gross is 0)
    if (gross > 0 && net >= gross) {
      warnings.push(buildWarn(
        'net_exceeds_gross',
        ['netPay', 'grossPay'],
        `Net pay ($${net.toFixed(2)}) is ≥ gross pay ($${gross.toFixed(2)}). Net pay must be less than gross.`,
        'blocking',
        net - gross,
      ));
    }

    // Verify net ≈ gross - (all taxes + deductions)
    const totalTaxes = fed + state + ss + mcare;
    const totalDeductions = union + ins + retire + other;
    const anyTaxDeductField =
      num(fields, 'federalTax') !== null ||
      num(fields, 'stateTax') !== null ||
      num(fields, 'socialSecurity') !== null ||
      num(fields, 'medicare') !== null;

    if (anyTaxDeductField && totalTaxes > 0) {
      const expected = gross - totalTaxes - totalDeductions;
      const delta = net - expected;
      if (!withinTolerance(expected, net, Math.max(5, gross * 0.02), 0.02)) {
        warnings.push(buildWarn(
          'net_pay_mismatch',
          ['netPay', 'grossPay', 'federalTax', 'stateTax', 'socialSecurity', 'medicare'],
          `Net pay ($${net.toFixed(2)}) doesn't reconcile with gross minus taxes/deductions (expected ~$${expected.toFixed(2)}, delta $${delta.toFixed(2)}). Check for missing deductions or extraction errors.`,
          'advisory',
          delta,
        ));
      }
    }
  }

  // Hours × rate ≈ regular gross component (advisory sanity check)
  const hours = num(fields, 'regularHours');
  const rate  = num(fields, 'hourlyRate');
  const ot    = num(fields, 'overtimeHours') ?? 0;
  const dt    = num(fields, 'doubleTimeHours') ?? 0;

  if (gross !== null && hours !== null && rate !== null && hours > 0 && rate > 0) {
    const regEarnings = hours * rate + ot * rate * 1.5 + dt * rate * 2;
    const bonus = (num(fields, 'bonus') ?? 0) + (num(fields, 'perDiem') ?? 0);
    const expected = regEarnings + bonus;
    // Only flag when gross is far off (> 10% and > $50) — many docs have missing hours
    if (Math.abs(gross - expected) > Math.max(50, gross * 0.10)) {
      warnings.push(buildWarn(
        'hours_rate_mismatch',
        ['grossPay', 'regularHours', 'hourlyRate'],
        `Computed regular earnings ($${regEarnings.toFixed(2)}) differs significantly from gross pay ($${gross.toFixed(2)}). Check hours and rate fields.`,
        'advisory',
        gross - expected,
      ));
    }
  }

  return warnings;
}

function reconcileBanking(fields: FlatFields): ReconciliationWarning[] {
  const warnings: ReconciliationWarning[] = [];

  const closing  = num(fields, 'closingBalance') ?? num(fields, 'currentBalance');
  const opening  = num(fields, 'openingBalance');
  const deposits = num(fields, 'totalDeposits');
  const withdrawals = num(fields, 'totalWithdrawals');

  // If we have all four, verify the identity
  if (closing !== null && opening !== null && deposits !== null && withdrawals !== null) {
    const expected = opening + deposits - withdrawals;
    const delta = closing - expected;
    if (!withinTolerance(expected, closing, Math.max(0.02, Math.abs(closing) * 0.005), 0.005)) {
      warnings.push(buildWarn(
        'statement_balance_mismatch',
        ['closingBalance', 'openingBalance', 'totalDeposits', 'totalWithdrawals'],
        `Closing balance ($${closing.toFixed(2)}) ≠ opening + deposits − withdrawals ($${expected.toFixed(2)}, delta $${delta.toFixed(2)}). One of these values may be misread.`,
        'advisory',
        delta,
      ));
    }
  }

  // Available ≤ current (advisory — pending transactions complicate this)
  const current   = num(fields, 'currentBalance');
  const available = num(fields, 'availableBalance');
  if (current !== null && available !== null && available > current + 0.02) {
    warnings.push(buildWarn(
      'available_exceeds_current',
      ['availableBalance', 'currentBalance'],
      `Available balance ($${available.toFixed(2)}) is greater than current balance ($${current.toFixed(2)}), which is unusual.`,
      'advisory',
      available - current,
    ));
  }

  return warnings;
}

function reconcileCreditCard(fields: FlatFields): ReconciliationWarning[] {
  const warnings: ReconciliationWarning[] = [];

  const balance   = num(fields, 'currentBalance') ?? num(fields, 'statementBalance');
  const limit     = num(fields, 'creditLimit');
  const available = num(fields, 'availableCredit');

  if (balance !== null && limit !== null && limit > 0) {
    // Balance should not exceed limit for a standard credit card
    if (balance > limit + 0.02) {
      warnings.push(buildWarn(
        'balance_exceeds_limit',
        ['currentBalance', 'creditLimit'],
        `Current balance ($${balance.toFixed(2)}) exceeds credit limit ($${limit.toFixed(2)}). This is unusual unless there are fees or penalties.`,
        'blocking',
        balance - limit,
      ));
    }

    // Available credit check: availableCredit ≈ creditLimit - currentBalance
    if (available !== null) {
      const expectedAvail = limit - balance;
      const delta = available - expectedAvail;
      if (!withinTolerance(expectedAvail, available, Math.max(1, limit * 0.01), 0.01)) {
        warnings.push(buildWarn(
          'available_credit_mismatch',
          ['availableCredit', 'creditLimit', 'currentBalance'],
          `Available credit ($${available.toFixed(2)}) doesn't match credit limit minus balance ($${expectedAvail.toFixed(2)}, delta $${delta.toFixed(2)}).`,
          'advisory',
          delta,
        ));
      }
    }
  }

  return warnings;
}

function reconcileLoan(fields: FlatFields): ReconciliationWarning[] {
  const warnings: ReconciliationWarning[] = [];

  const balance  = num(fields, 'currentBalance') ?? num(fields, 'balanceOwed');
  const original = num(fields, 'originalAmount');

  // Balance should not exceed original loan amount (unusual unless refinanced)
  if (balance !== null && original !== null && original > 0 && balance > original * 1.01) {
    warnings.push(buildWarn(
      'balance_exceeds_original',
      ['currentBalance', 'originalAmount'],
      `Current balance ($${balance.toFixed(2)}) exceeds original loan amount ($${original.toFixed(2)}). Verify these values.`,
      'advisory',
      balance - original,
    ));
  }

  return warnings;
}

function reconcileMortgage(fields: FlatFields): ReconciliationWarning[] {
  const warnings: ReconciliationWarning[] = [];

  const monthly = num(fields, 'monthlyPayment');
  const pi      = num(fields, 'principalAndInterest');
  const escrow  = num(fields, 'escrowAmount');

  // P&I + escrow ≈ total monthly payment
  if (monthly !== null && pi !== null && escrow !== null && pi > 0) {
    const expected = pi + escrow;
    const delta = monthly - expected;
    if (!withinTolerance(expected, monthly, Math.max(1, monthly * 0.01), 0.01)) {
      warnings.push(buildWarn(
        'payment_components_mismatch',
        ['monthlyPayment', 'principalAndInterest', 'escrowAmount'],
        `Monthly payment ($${monthly.toFixed(2)}) doesn't match P&I + escrow ($${expected.toFixed(2)}, delta $${delta.toFixed(2)}).`,
        'advisory',
        delta,
      ));
    }
  }

  // Balance ≤ original
  const balance  = num(fields, 'principalBalance');
  const original = num(fields, 'originalLoanAmount');
  if (balance !== null && original !== null && original > 0 && balance > original * 1.005) {
    warnings.push(buildWarn(
      'balance_exceeds_original',
      ['principalBalance', 'originalLoanAmount'],
      `Principal balance ($${balance.toFixed(2)}) exceeds original loan amount ($${original.toFixed(2)}).`,
      'advisory',
      balance - original,
    ));
  }

  return warnings;
}

function reconcileHELOC(fields: FlatFields): ReconciliationWarning[] {
  const warnings: ReconciliationWarning[] = [];

  const balance   = num(fields, 'currentBalance');
  const limit     = num(fields, 'creditLimit');
  const available = num(fields, 'availableCredit');

  if (balance !== null && limit !== null && limit > 0 && balance > limit * 1.01) {
    warnings.push(buildWarn(
      'heloc_balance_exceeds_limit',
      ['currentBalance', 'creditLimit'],
      `HELOC balance ($${balance.toFixed(2)}) exceeds credit limit ($${limit.toFixed(2)}).`,
      'blocking',
      balance - limit,
    ));
  }

  if (balance !== null && limit !== null && available !== null && limit > 0) {
    const expectedAvail = limit - balance;
    const delta = available - expectedAvail;
    if (!withinTolerance(expectedAvail, available, Math.max(1, limit * 0.01), 0.01)) {
      warnings.push(buildWarn(
        'heloc_available_mismatch',
        ['availableCredit', 'creditLimit', 'currentBalance'],
        `Available credit ($${available.toFixed(2)}) doesn't match limit minus balance ($${expectedAvail.toFixed(2)}, delta $${delta.toFixed(2)}).`,
        'advisory',
        delta,
      ));
    }
  }

  return warnings;
}

function reconcileBrokerage(fields: FlatFields): ReconciliationWarning[] {
  const warnings: ReconciliationWarning[] = [];

  const total      = num(fields, 'totalValue');
  const securities = num(fields, 'securitiesValue');
  const cash       = num(fields, 'cashBalance');

  if (total !== null && securities !== null && cash !== null) {
    const expected = securities + cash;
    const delta = total - expected;
    // Use a wider tolerance for brokerage (intraday prices)
    if (!withinTolerance(expected, total, Math.max(5, total * 0.02), 0.02)) {
      warnings.push(buildWarn(
        'total_components_mismatch',
        ['totalValue', 'securitiesValue', 'cashBalance'],
        `Total value ($${total.toFixed(2)}) doesn't match securities + cash ($${expected.toFixed(2)}, delta $${delta.toFixed(2)}).`,
        'advisory',
        delta,
      ));
    }
  }

  return warnings;
}

function reconcileRetirement(fields: FlatFields): ReconciliationWarning[] {
  const warnings: ReconciliationWarning[] = [];

  const current = num(fields, 'currentBalance');
  const vested  = num(fields, 'vestedBalance');

  if (current !== null && vested !== null && vested > current * 1.005) {
    warnings.push(buildWarn(
      'vested_exceeds_total',
      ['vestedBalance', 'currentBalance'],
      `Vested balance ($${vested.toFixed(2)}) exceeds total account balance ($${current.toFixed(2)}). Vested balance must be ≤ total.`,
      'advisory',
      vested - current,
    ));
  }

  return warnings;
}

function reconcileBill(fields: FlatFields): ReconciliationWarning[] {
  const warnings: ReconciliationWarning[] = [];

  const amount = num(fields, 'amountDue');
  if (amount !== null && amount < 0) {
    warnings.push(buildWarn(
      'negative_amount_due',
      ['amountDue'],
      `Amount due is negative ($${amount.toFixed(2)}). This may be a credit but cannot be imported as a bill amount.`,
      'advisory',
      amount,
    ));
  }

  return warnings;
}

// ─── Date period checks (shared across categories) ────────────────────────────

function checkStatementPeriod(fields: FlatFields): ReconciliationWarning[] {
  const warnings: ReconciliationWarning[] = [];

  const startRaw = (fields['statementStartDate']?.value ?? fields['payPeriodStart']?.value ?? null) as string | null;
  const endRaw   = (fields['statementEndDate']?.value ?? fields['payPeriodEnd']?.value ?? null) as string | null;

  if (!startRaw || !endRaw) return warnings;

  const start = new Date(String(startRaw));
  const end   = new Date(String(endRaw));
  const now   = new Date();

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return warnings;
  }

  if (end < start) {
    warnings.push(buildWarn(
      'period_end_before_start',
      ['statementStartDate', 'statementEndDate'],
      `Statement period end (${endRaw}) is before the start date (${startRaw}). The dates may be swapped.`,
      'advisory',
    ));
  }

  // End date more than 90 days in the future is suspicious
  const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  if (end > ninetyDaysFromNow) {
    warnings.push(buildWarn(
      'period_end_far_future',
      ['statementEndDate'],
      `Statement end date (${endRaw}) is more than 90 days in the future. Check for a date-format or two-digit-year error.`,
      'advisory',
    ));
  }

  return warnings;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

const RECONCILERS: Record<string, (fields: FlatFields) => ReconciliationWarning[]> = {
  Paystub:    reconcilePaystub,
  Banking:    reconcileBanking,
  CreditCard: reconcileCreditCard,
  Loan:       reconcileLoan,
  Mortgage:   reconcileMortgage,
  HELOC:      reconcileHELOC,
  Brokerage:  reconcileBrokerage,
  Retirement: reconcileRetirement,
  Bill:       reconcileBill,
};

/**
 * Run all reconciliation rules for the given document type.
 * Returns a ReconciliationWarning[] — empty means no issues found.
 */
export function reconcile(docType: string, fields: FlatFields): ReconciliationWarning[] {
  const category = resolveCategory(docType);
  const categoryReconciler = RECONCILERS[category];

  const warnings: ReconciliationWarning[] = [];

  if (categoryReconciler) {
    warnings.push(...categoryReconciler(fields));
  }

  // Period checks apply to all categories
  warnings.push(...checkStatementPeriod(fields));

  return warnings;
}
