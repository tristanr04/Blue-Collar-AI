export type FilingStatus = "single" | "married_filing_jointly" | "married_filing_separately" | "head_of_household";
export type FLSAStatus = "confirmed_eligible" | "confirmed_ineligible" | "needs_confirmation";

export interface OvertimeEntry {
  regularRate: number;
  overtimeHours: number;
  overtimeRate?: number;
  overtimePay?: number;
  doubleTimeHours?: number;
  doubleTimeRate?: number;
  doubleTimePay?: number;
  hoursWorkedInWorkweek?: number;
  flsaStatus: FLSAStatus;
  reportedQualifiedOvertime?: number;
  source?: "paystub" | "w2_code_tt" | "1099" | "manual";
}

export interface OvertimeTaxInput {
  taxYear: number;
  filingStatus: FilingStatus;
  modifiedAdjustedGrossIncome: number;
  entries: OvertimeEntry[];
  hasValidEmploymentSSN?: boolean;
}

export interface OvertimeTaxResult {
  totalOvertimeCashPay: number;
  totalDoubleTimeCashPay: number;
  payrollTaxableOvertimeWages: number;
  candidateQualifiedPremium: number;
  allowedQualifiedOvertimeDeduction: number;
  federalIncomeTaxableOvertimeAfterDeduction: number;
  qualificationStatus: "qualified" | "partially_qualified" | "needs_confirmation" | "not_qualified";
  warnings: string[];
  rules: {
    taxYear: number;
    deductionAvailable: boolean;
    deductionCap: number;
    phaseoutThreshold: number;
    phaseoutReduction: number;
    version: string;
  };
}

const roundCents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const nonNegative = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;

/**
 * Federal qualified-overtime deduction rules enacted for tax years 2025-2028.
 * Keep these values versioned and outside UI components.
 */
export function getOvertimeDeductionRules(taxYear: number, filingStatus: FilingStatus) {
  const available = taxYear >= 2025 && taxYear <= 2028;
  const joint = filingStatus === "married_filing_jointly";
  return {
    taxYear,
    available,
    cap: joint ? 25_000 : 12_500,
    phaseoutThreshold: joint ? 300_000 : 150_000,
    // IRC section 225 reduces the deduction by $100 for each $1,000 of excess MAGI.
    phaseoutRate: 0.10,
    version: "federal-qualified-overtime-2025-2028-v1",
  };
}

function cashPay(entry: OvertimeEntry): { overtime: number; doubleTime: number } {
  const regularRate = nonNegative(entry.regularRate);
  const overtimeHours = nonNegative(entry.overtimeHours);
  const doubleTimeHours = nonNegative(entry.doubleTimeHours);
  const overtime = entry.overtimePay !== undefined
    ? nonNegative(entry.overtimePay)
    : overtimeHours * nonNegative(entry.overtimeRate ?? regularRate * 1.5);
  const doubleTime = entry.doubleTimePay !== undefined
    ? nonNegative(entry.doubleTimePay)
    : doubleTimeHours * nonNegative(entry.doubleTimeRate ?? regularRate * 2);
  return { overtime, doubleTime };
}

function candidatePremium(entry: OvertimeEntry): { amount: number; needsConfirmation: boolean } {
  if (entry.reportedQualifiedOvertime !== undefined) {
    return { amount: nonNegative(entry.reportedQualifiedOvertime), needsConfirmation: false };
  }
  if (entry.flsaStatus === "confirmed_ineligible") return { amount: 0, needsConfirmation: false };
  if (entry.flsaStatus !== "confirmed_eligible") return { amount: 0, needsConfirmation: true };

  const regularRate = nonNegative(entry.regularRate);
  const overtimeHours = nonNegative(entry.overtimeHours);
  const workweekHours = entry.hoursWorkedInWorkweek;
  const flsaHours = workweekHours === undefined
    ? overtimeHours
    : Math.min(overtimeHours, Math.max(0, nonNegative(workweekHours) - 40));

  // Even when an employer pays 2x or more, the deductible amount is limited to
  // the FLSA-required premium above the regular rate: generally 0.5x.
  const standardPremium = flsaHours * regularRate * 0.5;
  return { amount: standardPremium, needsConfirmation: workweekHours === undefined };
}

export function calculateOvertimeTax(input: OvertimeTaxInput): OvertimeTaxResult {
  const rules = getOvertimeDeductionRules(input.taxYear, input.filingStatus);
  const warnings: string[] = [];
  let totalOvertimeCashPay = 0;
  let totalDoubleTimeCashPay = 0;
  let candidateQualifiedPremium = 0;
  let needsConfirmation = false;
  let anyQualified = false;

  for (const entry of input.entries ?? []) {
    const cash = cashPay(entry);
    totalOvertimeCashPay += cash.overtime;
    totalDoubleTimeCashPay += cash.doubleTime;

    const candidate = candidatePremium(entry);
    candidateQualifiedPremium += candidate.amount;
    needsConfirmation ||= candidate.needsConfirmation;
    anyQualified ||= candidate.amount > 0;
  }

  totalOvertimeCashPay = roundCents(totalOvertimeCashPay);
  totalDoubleTimeCashPay = roundCents(totalDoubleTimeCashPay);
  candidateQualifiedPremium = roundCents(candidateQualifiedPremium);
  const payrollTaxableOvertimeWages = roundCents(totalOvertimeCashPay + totalDoubleTimeCashPay);

  let allowed = 0;
  let phaseoutReduction = 0;
  if (!rules.available) {
    warnings.push("The federal qualified-overtime deduction is not available for this tax year under current law.");
  } else if (input.filingStatus === "married_filing_separately") {
    warnings.push("Married taxpayers must file jointly to claim the qualified-overtime deduction.");
  } else if (input.hasValidEmploymentSSN === false) {
    warnings.push("A Social Security number valid for employment is required to claim the deduction.");
  } else {
    const capped = Math.min(candidateQualifiedPremium, rules.cap);
    const excessMagi = Math.max(0, nonNegative(input.modifiedAdjustedGrossIncome) - rules.phaseoutThreshold);
    phaseoutReduction = roundCents(excessMagi * rules.phaseoutRate);
    allowed = roundCents(Math.max(0, capped - phaseoutReduction));
  }

  if (candidateQualifiedPremium > rules.cap) warnings.push(`Qualified overtime is limited to the ${rules.cap.toLocaleString("en-US", { style: "currency", currency: "USD" })} annual deduction cap for this filing status.`);
  if (phaseoutReduction > 0) warnings.push("The deduction was reduced because modified adjusted gross income exceeds the phaseout threshold.");
  if (needsConfirmation) warnings.push("Some overtime needs FLSA eligibility or workweek confirmation before it can be treated as qualified overtime.");
  if (totalDoubleTimeCashPay > 0) warnings.push("Double-time pay remains fully subject to payroll taxes; only the FLSA-required premium portion may qualify for the federal deduction.");
  warnings.push("All overtime compensation remains subject to Social Security and Medicare taxes, and generally to paycheck withholding. The deduction affects annual federal taxable income, not gross wages.");

  let qualificationStatus: OvertimeTaxResult["qualificationStatus"] = "not_qualified";
  if (needsConfirmation && anyQualified) qualificationStatus = "partially_qualified";
  else if (needsConfirmation) qualificationStatus = "needs_confirmation";
  else if (allowed > 0) qualificationStatus = "qualified";

  return {
    totalOvertimeCashPay,
    totalDoubleTimeCashPay,
    payrollTaxableOvertimeWages,
    candidateQualifiedPremium,
    allowedQualifiedOvertimeDeduction: allowed,
    federalIncomeTaxableOvertimeAfterDeduction: roundCents(Math.max(0, payrollTaxableOvertimeWages - allowed)),
    qualificationStatus,
    warnings,
    rules: {
      taxYear: input.taxYear,
      deductionAvailable: rules.available,
      deductionCap: rules.cap,
      phaseoutThreshold: rules.phaseoutThreshold,
      phaseoutReduction,
      version: rules.version,
    },
  };
}
