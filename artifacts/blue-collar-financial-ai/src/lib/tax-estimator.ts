export type FilingStatus = 'Single' | 'Married Filing Jointly' | 'Married Filing Separately' | 'Head of Household';

export interface WageTaxEstimateInput {
  filingStatus: FilingStatus;
  stateCode: string;
  annualRegularWages: number;
  annualOvertimeWages: number;
  /** FLSA-required premium above the regular rate, usually the 0.5x portion of time-and-a-half. */
  annualQualifiedOvertimePremium: number;
  annualPretaxDeductions?: number;
  annualOtherTaxableIncome?: number;
  socialSecurityWagesBeforePeriod?: number;
}

export interface WageTaxEstimate {
  taxYear: 2026;
  grossIncome: number;
  qualifiedOvertimeDeduction: number;
  federalTaxableIncome: number;
  federalIncomeTax: number;
  socialSecurityTax: number;
  medicareTax: number;
  additionalMedicareTax: number;
  stateIncomeTax: number | null;
  totalEstimatedTax: number;
  effectiveTaxRate: number;
  overtimeIncrementalTax: number;
  overtimeEffectiveTaxRate: number | null;
  estimatedAfterTaxOvertime: number;
  warnings: string[];
  assumptions: string[];
}

interface TaxBracket { upTo: number | null; rate: number }

const STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  Single: 16_100,
  'Married Filing Jointly': 32_200,
  'Married Filing Separately': 16_100,
  'Head of Household': 24_150,
};

const FEDERAL_BRACKETS: Record<FilingStatus, readonly TaxBracket[]> = {
  Single: [
    { upTo: 12_400, rate: 0.10 }, { upTo: 50_400, rate: 0.12 },
    { upTo: 105_700, rate: 0.22 }, { upTo: 201_775, rate: 0.24 },
    { upTo: 256_225, rate: 0.32 }, { upTo: 640_600, rate: 0.35 },
    { upTo: null, rate: 0.37 },
  ],
  'Married Filing Jointly': [
    { upTo: 24_800, rate: 0.10 }, { upTo: 100_800, rate: 0.12 },
    { upTo: 211_400, rate: 0.22 }, { upTo: 403_550, rate: 0.24 },
    { upTo: 512_450, rate: 0.32 }, { upTo: 768_700, rate: 0.35 },
    { upTo: null, rate: 0.37 },
  ],
  'Married Filing Separately': [
    { upTo: 12_400, rate: 0.10 }, { upTo: 50_400, rate: 0.12 },
    { upTo: 105_700, rate: 0.22 }, { upTo: 201_775, rate: 0.24 },
    { upTo: 256_225, rate: 0.32 }, { upTo: 384_350, rate: 0.35 },
    { upTo: null, rate: 0.37 },
  ],
  'Head of Household': [
    { upTo: 17_700, rate: 0.10 }, { upTo: 67_450, rate: 0.12 },
    { upTo: 105_700, rate: 0.22 }, { upTo: 201_750, rate: 0.24 },
    { upTo: 256_200, rate: 0.32 }, { upTo: 640_600, rate: 0.35 },
    { upTo: null, rate: 0.37 },
  ],
};

const SS_RATE = 0.062;
const SS_WAGE_BASE = 184_500;
const MEDICARE_RATE = 0.0145;
const ADDITIONAL_MEDICARE_RATE = 0.009;
const ADDITIONAL_MEDICARE_THRESHOLD = 200_000;

function nn(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Number(value) : 0;
}

export function progressiveTax(taxableIncome: number, brackets: readonly TaxBracket[]): number {
  const income = Math.max(0, taxableIncome);
  let tax = 0;
  let lower = 0;
  for (const bracket of brackets) {
    const upper = bracket.upTo ?? Number.POSITIVE_INFINITY;
    if (income <= lower) break;
    tax += (Math.min(income, upper) - lower) * bracket.rate;
    lower = upper;
  }
  return tax;
}

function overtimeDeduction(input: WageTaxEstimateInput, magiBeforeDeduction: number): number {
  if (input.filingStatus === 'Married Filing Separately') return 0;
  const joint = input.filingStatus === 'Married Filing Jointly';
  const cap = joint ? 25_000 : 12_500;
  const phaseoutStart = joint ? 300_000 : 150_000;
  const eligiblePremium = Math.min(nn(input.annualQualifiedOvertimePremium), nn(input.annualOvertimeWages), cap);
  const phaseout = Math.max(0, magiBeforeDeduction - phaseoutStart) * 0.10;
  return Math.max(0, eligiblePremium - phaseout);
}

function oklahomaTax(taxableIncome: number, status: FilingStatus): number {
  const jointSchedule = status === 'Married Filing Jointly' || status === 'Head of Household';
  const brackets: readonly TaxBracket[] = jointSchedule
    ? [{ upTo: 2_000, rate: .0025 }, { upTo: 5_000, rate: .0075 }, { upTo: 7_500, rate: .0175 }, { upTo: 9_800, rate: .0275 }, { upTo: 14_400, rate: .0375 }, { upTo: null, rate: .0475 }]
    : [{ upTo: 1_000, rate: .0025 }, { upTo: 2_500, rate: .0075 }, { upTo: 3_750, rate: .0175 }, { upTo: 4_900, rate: .0275 }, { upTo: 7_200, rate: .0375 }, { upTo: null, rate: .0475 }];
  return progressiveTax(taxableIncome, brackets);
}

function core(input: WageTaxEstimateInput) {
  const regular = nn(input.annualRegularWages);
  const overtime = nn(input.annualOvertimeWages);
  const grossWages = regular + overtime;
  const grossIncome = Math.max(0, grossWages + nn(input.annualOtherTaxableIncome) - nn(input.annualPretaxDeductions));
  const qualifiedOvertimeDeduction = overtimeDeduction(input, grossIncome);
  const federalTaxableIncome = Math.max(0, grossIncome - qualifiedOvertimeDeduction - STANDARD_DEDUCTION[input.filingStatus]);
  const federalIncomeTax = progressiveTax(federalTaxableIncome, FEDERAL_BRACKETS[input.filingStatus]);

  const priorSsWages = nn(input.socialSecurityWagesBeforePeriod);
  const socialSecurityTax = Math.min(grossWages, Math.max(0, SS_WAGE_BASE - priorSsWages)) * SS_RATE;
  const medicareTax = grossWages * MEDICARE_RATE;
  const additionalMedicareTax = Math.max(0, priorSsWages + grossWages - ADDITIONAL_MEDICARE_THRESHOLD) * ADDITIONAL_MEDICARE_RATE;
  const stateCode = input.stateCode.trim().toUpperCase();
  const stateIncomeTax = stateCode === 'OK' ? oklahomaTax(federalTaxableIncome, input.filingStatus) : null;
  const totalEstimatedTax = federalIncomeTax + socialSecurityTax + medicareTax + additionalMedicareTax + (stateIncomeTax ?? 0);

  return { grossIncome, qualifiedOvertimeDeduction, federalTaxableIncome, federalIncomeTax, socialSecurityTax, medicareTax, additionalMedicareTax, stateIncomeTax, totalEstimatedTax };
}

export function estimateWageAndOvertimeTax(input: WageTaxEstimateInput): WageTaxEstimate {
  const withOt = core(input);
  const withoutOt = core({ ...input, annualOvertimeWages: 0, annualQualifiedOvertimePremium: 0 });
  const overtime = nn(input.annualOvertimeWages);
  const overtimeIncrementalTax = Math.max(0, withOt.totalEstimatedTax - withoutOt.totalEstimatedTax);
  const warnings: string[] = [];
  if (input.stateCode.trim().toUpperCase() !== 'OK') warnings.push('State income tax is not yet calculated for this state.');
  if (input.filingStatus === 'Married Filing Separately' && nn(input.annualQualifiedOvertimePremium) > 0) warnings.push('Married taxpayers generally must file jointly to claim the qualified overtime deduction.');
  if (nn(input.annualQualifiedOvertimePremium) > nn(input.annualOvertimeWages)) warnings.push('Qualified overtime premium was capped at total overtime wages.');

  return {
    taxYear: 2026,
    ...withOt,
    effectiveTaxRate: withOt.grossIncome > 0 ? withOt.totalEstimatedTax / withOt.grossIncome : 0,
    overtimeIncrementalTax,
    overtimeEffectiveTaxRate: overtime > 0 ? overtimeIncrementalTax / overtime : null,
    estimatedAfterTaxOvertime: Math.max(0, overtime - overtimeIncrementalTax),
    warnings,
    assumptions: [
      'Uses 2026 federal brackets and standard deduction.',
      'Overtime is not taxed at a special federal rate; only the qualified premium may be deductible.',
      'Payroll taxes still apply to overtime.',
      'Estimate excludes credits, itemized deductions, local taxes, and most special tax situations.',
    ],
  };
}
