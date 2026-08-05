/**
 * Tax Year 2026 — All year-specific tax constants and rules.
 *
 * IMPORTANT: Never reference these values directly inside UI components.
 * Import from tax-rules/index.ts using getTaxRules(year) so future tax-year
 * updates require only a new file here + updating the dispatcher.
 */

export type FilingStatus =
  | 'Single'
  | 'Married Filing Jointly'
  | 'Married Filing Separately'
  | 'Head of Household';

export interface TaxBracket {
  /** Upper boundary of this bracket (null = unlimited). */
  upTo: number | null;
  rate: number;
}

export interface IRAPhaseout {
  /** MAGI at which phase-out begins. */
  start: number;
  /** MAGI at which deductibility is fully eliminated. */
  end: number;
}

export interface TaxYearRules {
  year: 2026;

  // ── Standard deductions ────────────────────────────────────────────────────
  standardDeduction: Record<FilingStatus, number>;

  // ── Federal income tax brackets ────────────────────────────────────────────
  federalBrackets: Record<FilingStatus, readonly TaxBracket[]>;

  // ── FICA ──────────────────────────────────────────────────────────────────
  /** Employee share Social Security rate. */
  ssRate: number;
  /** Annual Social Security wage base. */
  ssWageBase: number;
  /** Employee share Medicare rate. */
  medicareRate: number;
  /** Additional Medicare surtax rate on wages above threshold. */
  additionalMedicareRate: number;
  /** Threshold at which additional Medicare applies, by filing status. */
  additionalMedicareThreshold: Record<FilingStatus, number>;

  // ── Self-employment tax ────────────────────────────────────────────────────
  /** Net earnings factor before applying SE tax (92.35 %). */
  seIncomeRatio: number;
  /** Combined SE rate (employer + employee, 15.3 %). */
  seTaxRate: number;

  // ── 2026 Qualified Overtime Deduction ─────────────────────────────────────
  overtimeDeductionCap: Record<'single' | 'joint', number>;
  overtimePhaseoutStart: Record<'single' | 'joint', number>;
  /** Phase-out reduction: cents per dollar of MAGI above phase-out start. */
  overtimePhaseoutRate: number;

  // ── Tax credits ────────────────────────────────────────────────────────────
  childTaxCreditAmount: number;
  childTaxCreditPhaseoutStart: Record<FilingStatus, number>;
  /** Reduction per $1,000 of MAGI above phase-out start ($50 → 0.05). */
  childTaxCreditPhaseoutPer1k: number;
  otherDependentCreditAmount: number;

  // ── Contribution limits ────────────────────────────────────────────────────
  /** Employee 401(k) elective deferral limit (under age 50). */
  traditional401kLimit: number;
  /** 401(k) catch-up limit for age 50+. */
  traditional401kCatchupLimit: number;
  /** HSA annual limit — self-only coverage. */
  hsaLimitSelf: number;
  /** HSA annual limit — family coverage. */
  hsaLimitFamily: number;
  /** Traditional / Roth IRA contribution limit (under age 50). */
  iraLimit: number;
  /** IRA catch-up limit for age 50+. */
  iraCatchupLimit: number;

  /**
   * Traditional IRA deductibility phase-out ranges (MAGI) for taxpayers
   * covered by an employer retirement plan.  null = always deductible.
   */
  iraDeductPhaseout: Record<FilingStatus, IRAPhaseout | null>;

  // ── Oklahoma state income tax ──────────────────────────────────────────────
  oklahomaBrackets: Record<'single' | 'joint', readonly TaxBracket[]>;
}

export const TAX_RULES_2026: TaxYearRules = {
  year: 2026,

  standardDeduction: {
    Single: 16_100,
    'Married Filing Jointly': 32_200,
    'Married Filing Separately': 16_100,
    'Head of Household': 24_150,
  },

  federalBrackets: {
    Single: [
      { upTo: 12_400,  rate: 0.10 },
      { upTo: 50_400,  rate: 0.12 },
      { upTo: 105_700, rate: 0.22 },
      { upTo: 201_775, rate: 0.24 },
      { upTo: 256_225, rate: 0.32 },
      { upTo: 640_600, rate: 0.35 },
      { upTo: null,    rate: 0.37 },
    ],
    'Married Filing Jointly': [
      { upTo: 24_800,  rate: 0.10 },
      { upTo: 100_800, rate: 0.12 },
      { upTo: 211_400, rate: 0.22 },
      { upTo: 403_550, rate: 0.24 },
      { upTo: 512_450, rate: 0.32 },
      { upTo: 768_700, rate: 0.35 },
      { upTo: null,    rate: 0.37 },
    ],
    'Married Filing Separately': [
      { upTo: 12_400,  rate: 0.10 },
      { upTo: 50_400,  rate: 0.12 },
      { upTo: 105_700, rate: 0.22 },
      { upTo: 201_775, rate: 0.24 },
      { upTo: 256_225, rate: 0.32 },
      { upTo: 384_350, rate: 0.35 },
      { upTo: null,    rate: 0.37 },
    ],
    'Head of Household': [
      { upTo: 17_700,  rate: 0.10 },
      { upTo: 67_450,  rate: 0.12 },
      { upTo: 105_700, rate: 0.22 },
      { upTo: 201_750, rate: 0.24 },
      { upTo: 256_200, rate: 0.32 },
      { upTo: 640_600, rate: 0.35 },
      { upTo: null,    rate: 0.37 },
    ],
  },

  ssRate: 0.062,
  ssWageBase: 184_500,
  medicareRate: 0.0145,
  additionalMedicareRate: 0.009,
  additionalMedicareThreshold: {
    Single: 200_000,
    'Married Filing Jointly': 250_000,
    'Married Filing Separately': 125_000,
    'Head of Household': 200_000,
  },

  seIncomeRatio: 0.9235,
  seTaxRate: 0.153,

  overtimeDeductionCap: { single: 12_500, joint: 25_000 },
  overtimePhaseoutStart: { single: 150_000, joint: 300_000 },
  overtimePhaseoutRate: 0.10,

  childTaxCreditAmount: 2_000,
  childTaxCreditPhaseoutStart: {
    Single: 200_000,
    'Married Filing Jointly': 400_000,
    'Married Filing Separately': 200_000,
    'Head of Household': 200_000,
  },
  childTaxCreditPhaseoutPer1k: 0.05, // $50 per $1,000

  otherDependentCreditAmount: 500,

  traditional401kLimit: 23_500,
  traditional401kCatchupLimit: 31_000,
  hsaLimitSelf: 4_300,
  hsaLimitFamily: 8_550,
  iraLimit: 7_000,
  iraCatchupLimit: 8_000,

  iraDeductPhaseout: {
    // Covered by employer plan:
    Single: { start: 79_000, end: 89_000 },
    'Married Filing Jointly': { start: 126_000, end: 146_000 },
    'Married Filing Separately': { start: 0, end: 10_000 },
    'Head of Household': { start: 79_000, end: 89_000 },
  },

  oklahomaBrackets: {
    single: [
      { upTo: 1_000,  rate: 0.0025 },
      { upTo: 2_500,  rate: 0.0075 },
      { upTo: 3_750,  rate: 0.0175 },
      { upTo: 4_900,  rate: 0.0275 },
      { upTo: 7_200,  rate: 0.0375 },
      { upTo: null,   rate: 0.0475 },
    ],
    joint: [
      { upTo: 2_000,  rate: 0.0025 },
      { upTo: 5_000,  rate: 0.0075 },
      { upTo: 7_500,  rate: 0.0175 },
      { upTo: 9_800,  rate: 0.0275 },
      { upTo: 14_400, rate: 0.0375 },
      { upTo: null,   rate: 0.0475 },
    ],
  },
};
