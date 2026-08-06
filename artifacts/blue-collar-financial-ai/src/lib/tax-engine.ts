/**
 * Tax Engine — production-ready tax computation module for Blue Collar AI.
 *
 * This module is framework-free (no React) and contains only pure functions.
 * All year-specific constants come from tax-rules/; never hard-code them here.
 *
 * Scope:
 *  - Federal income tax (progressive brackets, standard deduction)
 *  - 2026 Qualified Overtime Deduction
 *  - FICA (Social Security + Medicare + Additional Medicare)
 *  - Self-employment (1099) income and SE tax
 *  - Traditional IRA deductibility phase-out
 *  - Child Tax Credit and Other Dependent Credit (with phase-outs)
 *  - Pre-tax deductions: 401(k), HSA, health insurance, other payroll deductions
 *  - All-state income tax (50 states + DC) via state-tax-rates module
 *  - YTD withholding → estimated refund / amount owed
 *  - Remaining estimated tax per paycheck
 *  - Confidence scoring based on data completeness
 *  - Tax-saving opportunity recommendations
 */

import { getTaxRules, DEFAULT_TAX_YEAR } from './tax-rules/index';
import type { FilingStatus, TaxBracket, TaxYearRules } from './tax-rules/index';
import { calcStateTax } from './state-tax-rates';

export type { FilingStatus };

// ─── Pay frequency ────────────────────────────────────────────────────────────

export type PayFrequency = 'Weekly' | 'Bi-Weekly' | 'Semi-Monthly' | 'Monthly';

export const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  Weekly: 52,
  'Bi-Weekly': 26,
  'Semi-Monthly': 24,
  Monthly: 12,
};

// ─── Input type ───────────────────────────────────────────────────────────────

export interface TaxEngineInput {
  taxYear: number;

  // ── Filing information ─────────────────────────────────────────────────────
  filingStatus: FilingStatus;
  /** Two-letter state code, e.g. 'OK'. '' or null = federal only. */
  stateCode: string;
  /** Number of qualifying children (child tax credit). */
  qualifyingChildren: number;
  /** Number of other dependents ($500 credit each). */
  otherDependents: number;

  // ── W-2 wage components (all annualised) ──────────────────────────────────
  annualRegularWages: number;
  annualOvertimeWages: number;
  annualDoubleTimeWages: number;
  annualBonuses: number;
  /** Standby / on-call pay — taxable. */
  annualStandbyPay: number;
  /**
   * FLSA overtime premium eligible for the 2026 qualified overtime deduction:
   * 0.5× rate for time-and-a-half hours + 1.0× rate for double-time hours.
   */
  annualQualifiedOvertimePremium: number;

  // ── Per diem ───────────────────────────────────────────────────────────────
  /** Per diem amounts that ARE included in taxable wages (above IRS limits). */
  annualTaxablePerDiem: number;
  /** Per diem amounts that are NOT taxable (qualifying reimbursements). */
  annualNonTaxablePerDiem: number;

  // ── Additional income sources ──────────────────────────────────────────────
  /** Second W-2 job annual wages. */
  secondJobAnnualWages: number;
  /** Spouse's annual wages (relevant for MFJ). */
  spouseAnnualWages: number;
  /** Gross 1099-NEC / Schedule C income. */
  annual1099Income: number;
  /** Deductible Schedule C business expenses against 1099 income. */
  annual1099Expenses: number;

  // ── Pre-tax deductions (reduce federal taxable income) ────────────────────
  /** Traditional (pre-tax) 401(k) employee contributions. */
  annualTraditional401k: number;
  /** HSA payroll contributions (Section 125 — also reduce FICA wages). */
  annualHSA: number;
  /** Employer-sponsored health insurance premiums (Section 125 — also reduce FICA). */
  annualHealthInsurancePremiums: number;
  /** Other pre-tax Section 125 or payroll deductions. */
  annualOtherPreTaxDeductions: number;

  // ── After-tax / IRA contributions ─────────────────────────────────────────
  /** Roth 401(k) contributions — do NOT reduce federal taxable income or FICA. */
  annualRoth401k: number;
  /**
   * Traditional IRA contributions — may be deductible depending on MAGI and
   * employer-plan coverage.  The engine calculates the deductible portion.
   */
  annualTraditionalIRA: number;
  /**
   * True if the taxpayer (or spouse for MFJ) is covered by an employer
   * retirement plan.  Affects IRA deductibility phase-out applicability.
   */
  coveredByEmployerPlan: boolean;

  // ── Year-to-date figures (optional — enables withholding calculation) ─────
  ytdFederalWithheld: number;
  ytdStateWithheld: number;
  ytdSocialSecurityWithheld: number;
  ytdMedicareWithheld: number;
  /**
   * YTD gross pay (before any deductions).  Used to estimate how many pay
   * periods have elapsed for the "remaining tax per paycheck" calculation.
   */
  ytdGrossPay: number;
  /**
   * SS wages already paid before this pay period (from a prior employer or
   * earlier in the year).  Used to cap the SS tax at the wage base.
   */
  socialSecurityWagesBeforePeriod: number;

  // ── Pay schedule ──────────────────────────────────────────────────────────
  payFrequency: PayFrequency;

  // ── Additional withholding ────────────────────────────────────────────────
  /** Extra federal withholding elected per pay period. */
  additionalFederalWithholdingPerPeriod: number;
}

// ─── Output type ──────────────────────────────────────────────────────────────

export interface TaxSavingOpportunity {
  title: string;
  description: string;
  estimatedAnnualSaving: number;
}

export interface TaxEngineResult {
  taxYear: number;

  // ── Income summary ────────────────────────────────────────────────────────
  grossW2Wages: number;
  grossSEIncome: number;
  /** SE gross minus deductible expenses. */
  netSEIncome: number;
  /** Total gross before any deductions. */
  totalGrossIncome: number;

  // ── Pre-tax deductions ────────────────────────────────────────────────────
  /** Total pre-tax deductions reducing both income tax AND FICA (Section 125). */
  ficaReducingDeductions: number;
  /** Total pre-tax deductions reducing income tax (includes 401k which doesn't reduce FICA). */
  totalPreTaxDeductions: number;

  // ── Above-line adjustments (reduce AGI) ───────────────────────────────────
  seTaxDeduction: number;
  traditionalIRADeduction: number;

  // ── Adjusted Gross Income ─────────────────────────────────────────────────
  adjustedGrossIncome: number;

  // ── Federal income tax ────────────────────────────────────────────────────
  standardDeduction: number;
  qualifiedOvertimeDeduction: number;
  federalTaxableIncome: number;
  federalIncomeTaxBeforeCredits: number;
  /** Marginal bracket rate as a decimal (e.g. 0.22 for the 22 % bracket). */
  marginalBracketRate: number;
  childTaxCredit: number;
  otherDependentCredit: number;
  /** Federal income tax after subtracting non-refundable credits. */
  federalIncomeTax: number;

  // ── Payroll taxes ─────────────────────────────────────────────────────────
  /** Employee share of Social Security tax. */
  socialSecurityTax: number;
  /** Employee share of Medicare tax. */
  medicareTax: number;
  /** 0.9 % additional Medicare on wages above threshold. */
  additionalMedicareTax: number;
  /**
   * Self-employment tax (both halves, 15.3 %).
   * Half is deductible above-the-line (seTaxDeduction).
   */
  seTax: number;

  // ── State income tax ──────────────────────────────────────────────────────
  stateIncomeTax: number | null;

  // ── Totals ────────────────────────────────────────────────────────────────
  totalEstimatedTax: number;
  totalWithheldYTD: number;
  /**
   * Positive = estimated refund.
   * Negative = estimated amount owed.
   * Zero / undefined when no YTD withholding data is provided.
   */
  estimatedRefundOrOwed: number | null;

  // ── Effective rates ───────────────────────────────────────────────────────
  effectiveTaxRate: number;
  federalEffectiveRate: number;

  // ── Overtime incremental ──────────────────────────────────────────────────
  overtimeIncrementalTax: number;
  overtimeEffectiveTaxRate: number | null;
  estimatedAfterTaxOvertime: number;

  // ── Per-period estimates ──────────────────────────────────────────────────
  periodsPerYear: number;
  /** Estimated number of pay periods already elapsed this year. */
  estimatedElapsedPeriods: number;
  remainingPeriods: number;
  /**
   * How much additional tax the user should be withheld per remaining paycheck
   * to avoid an underpayment penalty.  Only set when YTD withholding is known.
   */
  estimatedRemainingTaxPerPeriod: number | null;

  // ── Data quality ──────────────────────────────────────────────────────────
  confidenceLevel: 'high' | 'medium' | 'low';
  confidenceScore: number;

  // ── Guidance ──────────────────────────────────────────────────────────────
  warnings: string[];
  assumptions: string[];
  taxSavingOpportunities: TaxSavingOpportunity[];

  // ── Convenience monthly figures ───────────────────────────────────────────
  monthlyFederalTax: number;
  monthlyStateTax: number | null;
  monthlyFICA: number;
  monthlyTotalTax: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Clamp a value to [0, ∞). */
function nn(v: number | undefined | null): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Apply progressive tax brackets to a taxable income amount. */
export function progressiveTax(
  taxableIncome: number,
  brackets: readonly TaxBracket[],
): number {
  const income = Math.max(0, taxableIncome);
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Number.POSITIVE_INFINITY;
    if (income <= lower) break;
    tax += (Math.min(income, upper) - lower) * b.rate;
    lower = upper;
  }
  return tax;
}

/** Return the marginal bracket rate (as a decimal) for the given income. */
function getMarginalRate(
  taxableIncome: number,
  brackets: readonly TaxBracket[],
): number {
  const income = Math.max(0, taxableIncome);
  for (const b of brackets) {
    if (b.upTo === null || income < b.upTo) return b.rate;
  }
  return brackets[brackets.length - 1].rate;
}

/**
 * Calculate the deductible portion of traditional IRA contributions.
 *
 * Phase-out is applied when the taxpayer is covered by an employer plan.
 * If not covered, the full contribution is deductible.
 */
function calcIRADeduction(
  contribution: number,
  magi: number,
  filingStatus: FilingStatus,
  coveredByEmployerPlan: boolean,
  rules: TaxYearRules,
): number {
  const contributed = Math.min(nn(contribution), rules.iraLimit);
  if (contributed === 0) return 0;
  if (!coveredByEmployerPlan) return contributed; // fully deductible

  const phaseout = rules.iraDeductPhaseout[filingStatus];
  if (!phaseout) return contributed; // no phase-out for this status

  if (magi <= phaseout.start) return contributed;
  if (magi >= phaseout.end) return 0;

  const fraction = (phaseout.end - magi) / (phaseout.end - phaseout.start);
  return Math.round(contributed * fraction);
}

/**
 * Calculate the child tax credit (including reduction for other dependents)
 * after applying the MAGI phase-out.
 */
function calcChildTaxCredit(
  qualifyingChildren: number,
  otherDependents: number,
  magi: number,
  filingStatus: FilingStatus,
  rules: TaxYearRules,
): { childCredit: number; otherDependentCredit: number } {
  const grossChildCredit = nn(qualifyingChildren) * rules.childTaxCreditAmount;
  const grossOtherCredit = nn(otherDependents) * rules.otherDependentCreditAmount;
  const grossTotal = grossChildCredit + grossOtherCredit;
  if (grossTotal === 0) return { childCredit: 0, otherDependentCredit: 0 };

  const phaseoutStart = rules.childTaxCreditPhaseoutStart[filingStatus];
  const excessOver1k = Math.max(0, Math.ceil((magi - phaseoutStart) / 1_000));
  const reduction = excessOver1k * (rules.childTaxCreditPhaseoutPer1k * 1_000);
  const netTotal = Math.max(0, grossTotal - reduction);

  // Apply reduction proportionally across child and other dependent credits
  const childFraction = grossTotal > 0 ? grossChildCredit / grossTotal : 0;
  return {
    childCredit: Math.round(netTotal * childFraction),
    otherDependentCredit: Math.round(netTotal * (1 - childFraction)),
  };
}

// State income tax is now handled by the universal state-tax-rates module.
// calcOklahomaTax has been replaced by calcStateTax(stateCode, income, filingStatus).

/** Score data completeness on a 0–100 scale. */
function calcConfidence(input: TaxEngineInput): {
  score: number;
  level: 'high' | 'medium' | 'low';
} {
  let score = 0;

  // Core wages entered (40 pts)
  if (nn(input.annualRegularWages) > 0) score += 40;
  else if (nn(input.annual1099Income) > 0) score += 30;

  // Filing info (20 pts)
  if (input.filingStatus) score += 10;
  if (input.stateCode) score += 10;

  // YTD withholding (25 pts)
  const hasYTD =
    input.ytdFederalWithheld > 0 ||
    input.ytdSocialSecurityWithheld > 0 ||
    input.ytdMedicareWithheld > 0;
  if (hasYTD) score += 25;
  else if (input.ytdGrossPay > 0) score += 10;

  // Deductions entered (10 pts)
  const hasDeductions =
    nn(input.annualTraditional401k) > 0 ||
    nn(input.annualHSA) > 0 ||
    nn(input.annualHealthInsurancePremiums) > 0 ||
    nn(input.annualTraditionalIRA) > 0;
  if (hasDeductions) score += 10;

  // Dependents considered (5 pts)
  if (input.qualifyingChildren >= 0 && input.otherDependents >= 0) score += 5;

  score = Math.min(100, score);
  const level = score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low';
  return { score, level };
}

/** Build a list of actionable tax-saving opportunities from the result. */
function buildOpportunities(
  input: TaxEngineInput,
  grossW2: number,
  rules: TaxYearRules,
  federalBracketRate: number,
  stateTaxRate: number,
  totalTaxBefore: number,
): TaxSavingOpportunity[] {
  const opportunities: TaxSavingOpportunity[] = [];
  const combinedRate = federalBracketRate + stateTaxRate;
  const stateDesc = input.stateCode ? ` (and ${input.stateCode})` : '';

  // 401(k) headroom
  const current401k = nn(input.annualTraditional401k);
  const max401k = rules.traditional401kLimit;
  if (current401k < max401k) {
    const headroom = max401k - current401k;
    const saving = Math.round(Math.min(headroom, 5_000) * combinedRate);
    opportunities.push({
      title: 'Increase your pre-tax 401(k) contribution',
      description: `You can contribute up to $${(max401k - current401k).toLocaleString()} more this year. Each additional dollar reduces your federal${stateDesc} taxable income.`,
      estimatedAnnualSaving: saving,
    });
  }

  // HSA (if not using one)
  if (nn(input.annualHSA) === 0 && grossW2 > 0) {
    const saving = Math.round(rules.hsaLimitSelf * combinedRate);
    opportunities.push({
      title: 'Open an HSA if you have a high-deductible health plan',
      description: `HSA contributions reduce your income tax AND payroll taxes. The ${rules.year} individual limit is $${rules.hsaLimitSelf.toLocaleString()}.`,
      estimatedAnnualSaving: saving,
    });
  }

  // Traditional IRA (if not maxed)
  const iraDeductible = nn(input.annualTraditionalIRA);
  if (iraDeductible < rules.iraLimit && !input.coveredByEmployerPlan) {
    const headroom = rules.iraLimit - iraDeductible;
    const saving = Math.round(headroom * federalBracketRate);
    opportunities.push({
      title: 'Contribute to a Traditional IRA',
      description: `Without an employer plan you can deduct up to $${rules.iraLimit.toLocaleString()} per year. For ${rules.year} the limit is $${rules.iraLimit.toLocaleString()} (or $${rules.iraCatchupLimit.toLocaleString()} if you are 50+).`,
      estimatedAnnualSaving: saving,
    });
  }

  // W-2 + 1099 opportunity hint
  if (nn(input.annual1099Income) > 0 && nn(input.annual1099Expenses) === 0) {
    opportunities.push({
      title: 'Deduct your Schedule C business expenses',
      description: 'You have 1099 income but no expenses entered. Deductible expenses for tools, vehicle mileage, home office, and professional fees reduce both income tax and self-employment tax.',
      estimatedAnnualSaving: 0,
    });
  }

  return opportunities;
}

// ─── Main computation ─────────────────────────────────────────────────────────

/**
 * Compute a detailed tax estimate for the given inputs.
 *
 * All amounts are annual (annualised from paystubs before calling this).
 * The caller is responsible for ensuring paystub records are de-duplicated.
 */
export function computeDetailedTax(input: TaxEngineInput): TaxEngineResult {
  const rules = getTaxRules(input.taxYear);
  const warnings: string[] = [];
  const assumptions: string[] = [];

  // ── 1. Gross wages ─────────────────────────────────────────────────────────
  const regularW2 =
    nn(input.annualRegularWages) +
    nn(input.annualOvertimeWages) +
    nn(input.annualDoubleTimeWages) +
    nn(input.annualBonuses) +
    nn(input.annualStandbyPay) +
    nn(input.annualTaxablePerDiem);
  const secondJobW2 = nn(input.secondJobAnnualWages);
  const spouseW2 = nn(input.spouseAnnualWages);
  const grossW2Wages = regularW2 + secondJobW2 + spouseW2;

  const gross1099 = nn(input.annual1099Income);
  const expenses1099 = Math.min(nn(input.annual1099Expenses), gross1099);
  const netSEIncome = gross1099 - expenses1099;

  const totalGrossIncome = grossW2Wages + netSEIncome;

  // ── 2. Pre-tax deductions ──────────────────────────────────────────────────
  // Section 125 (reduce FICA wages): health insurance + HSA
  const ficaReducing =
    nn(input.annualHealthInsurancePremiums) +
    nn(input.annualHSA);

  // All pre-tax deductions (reduce income tax):
  // 401(k) does NOT reduce FICA wages but DOES reduce income tax
  const totalPreTax =
    ficaReducing +
    nn(input.annualTraditional401k) +
    nn(input.annualOtherPreTaxDeductions);

  // ── 3. Self-employment tax ─────────────────────────────────────────────────
  const seNetForTax = Math.max(0, netSEIncome * rules.seIncomeRatio);
  const seTax = seNetForTax * rules.seTaxRate;
  const seTaxDeduction = seTax / 2; // above-the-line deduction

  // ── 4. Traditional IRA deduction ──────────────────────────────────────────
  // We first need MAGI (before IRA deduction) to apply phase-out correctly.
  // Simplified MAGI: AGI before IRA deduction.
  const magiBeforeIRA = Math.max(0, totalGrossIncome - totalPreTax - seTaxDeduction);
  const traditionalIRADeduction = calcIRADeduction(
    input.annualTraditionalIRA,
    magiBeforeIRA,
    input.filingStatus,
    input.coveredByEmployerPlan,
    rules,
  );

  // ── 5. AGI ─────────────────────────────────────────────────────────────────
  const adjustedGrossIncome = Math.max(
    0,
    totalGrossIncome - totalPreTax - seTaxDeduction - traditionalIRADeduction,
  );

  // ── 6. Qualified overtime deduction (2026) ────────────────────────────────
  const isJointForOT =
    input.filingStatus === 'Married Filing Jointly';
  const otCap = isJointForOT
    ? rules.overtimeDeductionCap.joint
    : rules.overtimeDeductionCap.single;
  const otPhaseoutStart = isJointForOT
    ? rules.overtimePhaseoutStart.joint
    : rules.overtimePhaseoutStart.single;

  let qualifiedOvertimeDeduction = 0;
  if (input.filingStatus !== 'Married Filing Separately') {
    const premium = Math.min(
      nn(input.annualQualifiedOvertimePremium),
      nn(input.annualOvertimeWages) + nn(input.annualDoubleTimeWages),
    );
    const eligible = Math.min(premium, otCap);
    const phaseoutReduction =
      Math.max(0, adjustedGrossIncome - otPhaseoutStart) * rules.overtimePhaseoutRate;
    qualifiedOvertimeDeduction = Math.max(0, eligible - phaseoutReduction);
  } else if (nn(input.annualQualifiedOvertimePremium) > 0) {
    warnings.push(
      'The qualified overtime deduction is not available for Married Filing Separately filers.',
    );
  }

  // ── 7. Federal taxable income ─────────────────────────────────────────────
  const standardDeduction = rules.standardDeduction[input.filingStatus];
  const federalTaxableIncome = Math.max(
    0,
    adjustedGrossIncome - qualifiedOvertimeDeduction - standardDeduction,
  );

  // ── 8. Federal income tax (before credits) ────────────────────────────────
  const brackets = rules.federalBrackets[input.filingStatus];
  const federalIncomeTaxBeforeCredits = progressiveTax(federalTaxableIncome, brackets);
  const marginalBracketRate = getMarginalRate(federalTaxableIncome, brackets);

  // ── 9. Tax credits ─────────────────────────────────────────────────────────
  const { childCredit, otherDependentCredit } = calcChildTaxCredit(
    input.qualifyingChildren,
    input.otherDependents,
    adjustedGrossIncome,
    input.filingStatus,
    rules,
  );
  const totalCredits = childCredit + otherDependentCredit;
  const federalIncomeTax = Math.max(0, federalIncomeTaxBeforeCredits - totalCredits);

  // ── 10. FICA ───────────────────────────────────────────────────────────────
  // FICA wages = W-2 gross minus Section 125 deductions (health ins + HSA)
  // Note: 401(k) contributions do NOT reduce FICA wages.
  const ficaWages = Math.max(0, grossW2Wages - ficaReducing);

  const priorSSWages = nn(input.socialSecurityWagesBeforePeriod);
  const socialSecurityTax =
    Math.min(ficaWages, Math.max(0, rules.ssWageBase - priorSSWages)) * rules.ssRate;
  const medicareTax = ficaWages * rules.medicareRate;

  // Additional Medicare applies to COMBINED wages + SE income over threshold
  const additionalMedicareThreshold =
    rules.additionalMedicareThreshold[input.filingStatus];
  const additionalMedicareBase = Math.max(
    0,
    ficaWages + seNetForTax - additionalMedicareThreshold,
  );
  const additionalMedicareTax = additionalMedicareBase * rules.additionalMedicareRate;

  // ── 11. State income tax ───────────────────────────────────────────────────
  const state = (input.stateCode ?? '').trim().toUpperCase();
  let stateIncomeTax: number | null = null;
  let stateEffectiveRate = 0;
  if (state !== '') {
    const stateResult = calcStateTax(state, federalTaxableIncome, input.filingStatus);
    if (!stateResult.entryFound) {
      warnings.push(
        `State income tax for ${state} is not yet in our database. This estimate shows federal totals only.`,
      );
    } else {
      stateIncomeTax = stateResult.tax;
      stateEffectiveRate = stateResult.effectiveRate ?? 0;
      if (stateResult.note) {
        assumptions.push(`${state}: ${stateResult.note}`);
      }
    }
  }

  // ── 12. Totals ─────────────────────────────────────────────────────────────
  const totalEstimatedTax =
    federalIncomeTax +
    socialSecurityTax +
    medicareTax +
    additionalMedicareTax +
    seTax +
    (stateIncomeTax ?? 0);

  const totalWithheldYTD =
    nn(input.ytdFederalWithheld) +
    nn(input.ytdStateWithheld) +
    nn(input.ytdSocialSecurityWithheld) +
    nn(input.ytdMedicareWithheld);

  const hasYTD =
    nn(input.ytdFederalWithheld) > 0 ||
    nn(input.ytdSocialSecurityWithheld) > 0 ||
    nn(input.ytdMedicareWithheld) > 0;

  const estimatedRefundOrOwed: number | null = hasYTD
    ? totalWithheldYTD - totalEstimatedTax
    : null;

  // ── 13. Overtime incremental ───────────────────────────────────────────────
  const otWages = nn(input.annualOvertimeWages) + nn(input.annualDoubleTimeWages);
  const withoutOtInput: TaxEngineInput = {
    ...input,
    annualOvertimeWages: 0,
    annualDoubleTimeWages: 0,
    annualQualifiedOvertimePremium: 0,
    annualStandbyPay: 0,
  };
  // Re-run only for incremental calc (no deep recursion — withoutOt has no OT)
  const withoutOtResult = _computeCore(withoutOtInput, rules);
  const overtimeIncrementalTax = Math.max(
    0,
    totalEstimatedTax - withoutOtResult.totalEstimatedTax,
  );
  const overtimeEffectiveTaxRate =
    otWages > 0 ? overtimeIncrementalTax / otWages : null;
  const estimatedAfterTaxOvertime = Math.max(0, otWages - overtimeIncrementalTax);

  // ── 14. Per-period estimates ───────────────────────────────────────────────
  const periodsPerYear = PERIODS_PER_YEAR[input.payFrequency] ?? 26;
  const annualGross = totalGrossIncome;
  const perPeriodGross = annualGross / periodsPerYear;

  let estimatedElapsedPeriods: number;
  if (hasYTD && nn(input.ytdGrossPay) > 0 && perPeriodGross > 0) {
    estimatedElapsedPeriods = Math.min(
      periodsPerYear - 1,
      Math.round(nn(input.ytdGrossPay) / perPeriodGross),
    );
  } else {
    // Fallback: estimate from current month (August 2026 ≈ 8/12 of year)
    const now = new Date();
    const monthFraction = (now.getMonth() + now.getDate() / 30) / 12;
    estimatedElapsedPeriods = Math.round(periodsPerYear * monthFraction);
  }
  const remainingPeriods = Math.max(1, periodsPerYear - estimatedElapsedPeriods);

  let estimatedRemainingTaxPerPeriod: number | null = null;
  if (hasYTD) {
    const remainingTaxDue = Math.max(0, totalEstimatedTax - totalWithheldYTD);
    const additionalWithholding =
      nn(input.additionalFederalWithholdingPerPeriod) * remainingPeriods;
    estimatedRemainingTaxPerPeriod = Math.max(
      0,
      (remainingTaxDue - additionalWithholding) / remainingPeriods,
    );
  }

  // ── 15. Effective rates ────────────────────────────────────────────────────
  const effectiveTaxRate =
    totalGrossIncome > 0 ? totalEstimatedTax / totalGrossIncome : 0;
  const federalEffectiveRate =
    totalGrossIncome > 0 ? federalIncomeTax / totalGrossIncome : 0;

  // ── 16. Confidence ─────────────────────────────────────────────────────────
  const { score: confidenceScore, level: confidenceLevel } = calcConfidence(input);

  // ── 17. Warnings ──────────────────────────────────────────────────────────
  if (nn(input.annualQualifiedOvertimePremium) > nn(input.annualOvertimeWages) + nn(input.annualDoubleTimeWages)) {
    warnings.push(
      'Qualified overtime premium was capped at total overtime wages.',
    );
  }
  if (nn(input.annualTraditional401k) > rules.traditional401kLimit) {
    warnings.push(
      `401(k) contributions exceed the ${rules.year} IRS limit of $${rules.traditional401kLimit.toLocaleString()}. Only the limit was used in this estimate.`,
    );
  }
  if (nn(input.annualHSA) > rules.hsaLimitFamily) {
    warnings.push(
      `HSA contributions exceed the ${rules.year} family limit of $${rules.hsaLimitFamily.toLocaleString()}.`,
    );
  }
  if (!hasYTD) {
    assumptions.push(
      'No year-to-date withholding data provided — refund/amount owed could not be calculated.',
    );
  }
  assumptions.push(
    `Uses ${rules.year} federal brackets and standard deduction.`,
    'Payroll taxes are not reduced by the qualified overtime deduction.',
    'Estimate excludes itemised deductions, tax credits not listed above, local taxes, and most complex tax situations.',
    'Self-employment tax applies if you have 1099 / Schedule C income.',
  );
  if (stateIncomeTax === null && state !== '') {
    // Already warned above
  } else if (stateIncomeTax === null && state === '') {
    assumptions.push('No state entered — state income tax not included.');
  }

  // ── 18. Tax-saving opportunities ──────────────────────────────────────────
  const opportunities = buildOpportunities(
    input,
    grossW2Wages,
    rules,
    marginalBracketRate,
    stateEffectiveRate,
    totalEstimatedTax,
  );

  // ── 19. Monthly convenience figures ────────────────────────────────────────
  const monthlyFederalTax = federalIncomeTax / 12;
  const monthlyStateTax = stateIncomeTax !== null ? stateIncomeTax / 12 : null;
  const monthlyFICA = (socialSecurityTax + medicareTax + additionalMedicareTax + seTax) / 12;
  const monthlyTotalTax = totalEstimatedTax / 12;

  return {
    taxYear: input.taxYear,
    grossW2Wages,
    grossSEIncome: gross1099,
    netSEIncome,
    totalGrossIncome,
    ficaReducingDeductions: ficaReducing,
    totalPreTaxDeductions: totalPreTax,
    seTaxDeduction,
    traditionalIRADeduction,
    adjustedGrossIncome,
    standardDeduction,
    qualifiedOvertimeDeduction,
    federalTaxableIncome,
    federalIncomeTaxBeforeCredits,
    marginalBracketRate,
    childTaxCredit: childCredit,
    otherDependentCredit,
    federalIncomeTax,
    socialSecurityTax,
    medicareTax,
    additionalMedicareTax,
    seTax,
    stateIncomeTax,
    totalEstimatedTax,
    totalWithheldYTD,
    estimatedRefundOrOwed,
    effectiveTaxRate,
    federalEffectiveRate,
    overtimeIncrementalTax,
    overtimeEffectiveTaxRate,
    estimatedAfterTaxOvertime,
    periodsPerYear,
    estimatedElapsedPeriods,
    remainingPeriods,
    estimatedRemainingTaxPerPeriod,
    confidenceScore,
    confidenceLevel,
    warnings,
    assumptions,
    taxSavingOpportunities: opportunities,
    monthlyFederalTax,
    monthlyStateTax,
    monthlyFICA,
    monthlyTotalTax,
  };
}

/**
 * Internal helper: compute tax totals only (no incremental OT, confidence, etc.)
 * Used by the overtime-incremental calculation to avoid deep recursion.
 */
function _computeCore(
  input: TaxEngineInput,
  rules: TaxYearRules,
): { totalEstimatedTax: number } {
  const regularW2 =
    nn(input.annualRegularWages) +
    nn(input.annualOvertimeWages) +
    nn(input.annualDoubleTimeWages) +
    nn(input.annualBonuses) +
    nn(input.annualStandbyPay) +
    nn(input.annualTaxablePerDiem);
  const secondJobW2 = nn(input.secondJobAnnualWages);
  const spouseW2 = nn(input.spouseAnnualWages);
  const grossW2 = regularW2 + secondJobW2 + spouseW2;

  const netSE = Math.max(0, nn(input.annual1099Income) - nn(input.annual1099Expenses));
  const seNetForTax = netSE * rules.seIncomeRatio;
  const seTax = seNetForTax * rules.seTaxRate;
  const seTaxDed = seTax / 2;

  const ficaReducing = nn(input.annualHealthInsurancePremiums) + nn(input.annualHSA);
  const totalPreTax =
    ficaReducing + nn(input.annualTraditional401k) + nn(input.annualOtherPreTaxDeductions);

  const magiForIRA = Math.max(0, grossW2 + netSE - totalPreTax - seTaxDed);
  const iraDed = calcIRADeduction(
    input.annualTraditionalIRA, magiForIRA, input.filingStatus,
    input.coveredByEmployerPlan, rules,
  );

  const agi = Math.max(0, grossW2 + netSE - totalPreTax - seTaxDed - iraDed);

  const isJointForOT = input.filingStatus === 'Married Filing Jointly';
  let otDed = 0;
  if (input.filingStatus !== 'Married Filing Separately') {
    const cap = isJointForOT ? rules.overtimeDeductionCap.joint : rules.overtimeDeductionCap.single;
    const phaseoutStart = isJointForOT ? rules.overtimePhaseoutStart.joint : rules.overtimePhaseoutStart.single;
    const premium = Math.min(
      nn(input.annualQualifiedOvertimePremium),
      nn(input.annualOvertimeWages) + nn(input.annualDoubleTimeWages),
    );
    const eligible = Math.min(premium, cap);
    const phaseoutRed = Math.max(0, agi - phaseoutStart) * rules.overtimePhaseoutRate;
    otDed = Math.max(0, eligible - phaseoutRed);
  }

  const stdDed = rules.standardDeduction[input.filingStatus];
  const fedTaxable = Math.max(0, agi - otDed - stdDed);
  const fedTaxBefore = progressiveTax(fedTaxable, rules.federalBrackets[input.filingStatus]);
  const { childCredit, otherDependentCredit } = calcChildTaxCredit(
    input.qualifyingChildren, input.otherDependents, agi, input.filingStatus, rules,
  );
  const fedTax = Math.max(0, fedTaxBefore - childCredit - otherDependentCredit);

  const ficaWages = Math.max(0, grossW2 - ficaReducing);
  const priorSS = nn(input.socialSecurityWagesBeforePeriod);
  const ssTax = Math.min(ficaWages, Math.max(0, rules.ssWageBase - priorSS)) * rules.ssRate;
  const medTax = ficaWages * rules.medicareRate;
  const addlMedBase = Math.max(0, ficaWages + seNetForTax - rules.additionalMedicareThreshold[input.filingStatus]);
  const addlMed = addlMedBase * rules.additionalMedicareRate;

  const state = (input.stateCode ?? '').trim().toUpperCase();
  const stateResult = state ? calcStateTax(state, fedTaxable, input.filingStatus) : null;
  const stateTax = stateResult?.tax ?? 0;

  return {
    totalEstimatedTax: fedTax + ssTax + medTax + addlMed + seTax + stateTax,
  };
}

// ─── Quick estimate builder ───────────────────────────────────────────────────

export interface PaystubSummary {
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  perDiem: number;
  grossPay: number;
  taxes: number;
}

export interface QuickEstimateOptions {
  paystubs: PaystubSummary[];
  /** Hourly rate (0 = unknown; fall back to grossPay). */
  hourlyRate: number;
  payFrequency: PayFrequency;
  filingStatus: FilingStatus;
  stateCode: string;
  qualifyingChildren: number;
  otherDependents: number;
  /** Annual pre-tax deductions from profile (simplification). */
  annualPreTaxDeductions: number;
  /** Extra taxable income to add (bonus, standby, other W-2). */
  additionalAnnualTaxableIncome: number;
  /** Taxable portion of per diem to add (default: 0 — treat all as non-taxable). */
  additionalTaxablePerDiem: number;
  taxYear?: number;
}

/**
 * Build a TaxEngineInput from paystub data for the Quick Estimate mode.
 *
 * All paystubs are averaged per-period and annualised using payFrequency.
 * Callers must ensure paystubs are de-duplicated before passing them in.
 */
export function buildQuickEstimateInput(opts: QuickEstimateOptions): TaxEngineInput {
  const stubs = opts.paystubs;
  const periodsPerYear = PERIODS_PER_YEAR[opts.payFrequency];
  const taxYear = opts.taxYear ?? DEFAULT_TAX_YEAR;

  // Per-period averages
  const avgRegHours = stubs.length > 0
    ? stubs.reduce((s, p) => s + p.regularHours, 0) / stubs.length : 0;
  const avgOtHours = stubs.length > 0
    ? stubs.reduce((s, p) => s + p.overtimeHours, 0) / stubs.length : 0;
  const avgDtHours = stubs.length > 0
    ? stubs.reduce((s, p) => s + p.doubleTimeHours, 0) / stubs.length : 0;
  const avgPerDiem = stubs.length > 0
    ? stubs.reduce((s, p) => s + p.perDiem, 0) / stubs.length : 0;
  const avgGrossPay = stubs.length > 0
    ? stubs.reduce((s, p) => s + p.grossPay, 0) / stubs.length : 0;

  let annualRegularWages: number;
  let annualOvertimeWages: number;
  let annualDoubleTimeWages: number;
  let annualQualifiedOvertimePremium: number;

  if (opts.hourlyRate > 0) {
    annualRegularWages = avgRegHours * opts.hourlyRate * periodsPerYear;
    annualOvertimeWages = avgOtHours * opts.hourlyRate * 1.5 * periodsPerYear;
    annualDoubleTimeWages = avgDtHours * opts.hourlyRate * 2 * periodsPerYear;
    // FLSA qualified premium: 0.5× for time-and-a-half, 1× for double-time
    annualQualifiedOvertimePremium =
      (avgOtHours * opts.hourlyRate * 0.5 + avgDtHours * opts.hourlyRate * 1.0) *
      periodsPerYear;
  } else {
    // No hourly rate — annualise grossPay minus per diem as regular wages
    const wageGross = Math.max(0, avgGrossPay - avgPerDiem);
    annualRegularWages = wageGross * periodsPerYear;
    annualOvertimeWages = 0;
    annualDoubleTimeWages = 0;
    annualQualifiedOvertimePremium = 0;
  }

  // Per diem: treat all paystub per diem as non-taxable (most common for blue-collar)
  const annualNonTaxablePerDiem = avgPerDiem * periodsPerYear;

  return {
    taxYear,
    filingStatus: opts.filingStatus,
    stateCode: opts.stateCode,
    qualifyingChildren: opts.qualifyingChildren,
    otherDependents: opts.otherDependents,
    annualRegularWages: annualRegularWages + opts.additionalAnnualTaxableIncome,
    annualOvertimeWages,
    annualDoubleTimeWages,
    annualBonuses: 0,
    annualStandbyPay: 0,
    annualQualifiedOvertimePremium,
    annualTaxablePerDiem: opts.additionalTaxablePerDiem,
    annualNonTaxablePerDiem,
    secondJobAnnualWages: 0,
    spouseAnnualWages: 0,
    annual1099Income: 0,
    annual1099Expenses: 0,
    annualTraditional401k: 0,
    annualHSA: 0,
    annualHealthInsurancePremiums: 0,
    annualOtherPreTaxDeductions: opts.annualPreTaxDeductions,
    annualRoth401k: 0,
    annualTraditionalIRA: 0,
    coveredByEmployerPlan: false,
    ytdFederalWithheld: 0,
    ytdStateWithheld: 0,
    ytdSocialSecurityWithheld: 0,
    ytdMedicareWithheld: 0,
    ytdGrossPay: 0,
    socialSecurityWagesBeforePeriod: 0,
    payFrequency: opts.payFrequency,
    additionalFederalWithholdingPerPeriod: 0,
  };
}

/** Create a blank TaxEngineInput with all zeros for the Detailed mode default state. */
export function blankDetailedInput(
  filingStatus: FilingStatus = 'Single',
  stateCode = '',
  payFrequency: PayFrequency = 'Weekly',
  taxYear = DEFAULT_TAX_YEAR,
): TaxEngineInput {
  return {
    taxYear,
    filingStatus,
    stateCode,
    qualifyingChildren: 0,
    otherDependents: 0,
    annualRegularWages: 0,
    annualOvertimeWages: 0,
    annualDoubleTimeWages: 0,
    annualBonuses: 0,
    annualStandbyPay: 0,
    annualQualifiedOvertimePremium: 0,
    annualTaxablePerDiem: 0,
    annualNonTaxablePerDiem: 0,
    secondJobAnnualWages: 0,
    spouseAnnualWages: 0,
    annual1099Income: 0,
    annual1099Expenses: 0,
    annualTraditional401k: 0,
    annualHSA: 0,
    annualHealthInsurancePremiums: 0,
    annualOtherPreTaxDeductions: 0,
    annualRoth401k: 0,
    annualTraditionalIRA: 0,
    coveredByEmployerPlan: true,
    ytdFederalWithheld: 0,
    ytdStateWithheld: 0,
    ytdSocialSecurityWithheld: 0,
    ytdMedicareWithheld: 0,
    ytdGrossPay: 0,
    socialSecurityWagesBeforePeriod: 0,
    payFrequency,
    additionalFederalWithholdingPerPeriod: 0,
  };
}
