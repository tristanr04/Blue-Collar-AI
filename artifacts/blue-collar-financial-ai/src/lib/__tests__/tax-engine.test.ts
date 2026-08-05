/**
 * Tax Engine unit tests — 2026 tax year.
 *
 * Covers: federal brackets, FICA, SE tax, 401(k) / HSA / IRA deductions,
 * per-diem handling, multiple jobs, child tax credit, qualified overtime
 * deduction, refund/owed calculation, irregular overtime, mixed W-2/1099,
 * edge cases (zero income, negative inputs, max contributions), and
 * confidence scoring.
 */

import { describe, it, expect } from 'vitest';
import {
  computeDetailedTax,
  buildQuickEstimateInput,
  progressiveTax,
  blankDetailedInput,
  type TaxEngineInput,
  type PayFrequency,
} from '../tax-engine';
import type { FilingStatus } from '../tax-rules/index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function base(overrides: Partial<TaxEngineInput> = {}): TaxEngineInput {
  return {
    ...blankDetailedInput('Single', 'OK', 'Weekly'),
    annualRegularWages: 60_000,
    ...overrides,
  };
}

function joint(overrides: Partial<TaxEngineInput> = {}): TaxEngineInput {
  return {
    ...blankDetailedInput('Married Filing Jointly', 'OK', 'Weekly'),
    annualRegularWages: 80_000,
    ...overrides,
  };
}

// ─── progressiveTax helper ────────────────────────────────────────────────────

describe('progressiveTax', () => {
  it('taxes only income inside each bracket layer', () => {
    const brackets = [{ upTo: 10_000, rate: 0.10 }, { upTo: null, rate: 0.20 }];
    expect(progressiveTax(10_000, brackets)).toBeCloseTo(1_000);
    expect(progressiveTax(20_000, brackets)).toBeCloseTo(3_000);
  });

  it('returns 0 for zero income', () => {
    const brackets = [{ upTo: 50_000, rate: 0.10 }, { upTo: null, rate: 0.20 }];
    expect(progressiveTax(0, brackets)).toBe(0);
    expect(progressiveTax(-100, brackets)).toBe(0);
  });
});

// ─── Federal income tax ───────────────────────────────────────────────────────

describe('federal income tax', () => {
  it('applies the standard deduction before taxing', () => {
    const res = computeDetailedTax(base({ annualRegularWages: 16_100 }));
    // Taxable income = 16,100 − 16,100 std deduction = 0
    expect(res.federalTaxableIncome).toBe(0);
    expect(res.federalIncomeTax).toBe(0);
  });

  it('produces a positive tax above the standard deduction threshold', () => {
    const res = computeDetailedTax(base({ annualRegularWages: 50_000 }));
    expect(res.federalIncomeTax).toBeGreaterThan(0);
  });

  it('higher income has a higher effective rate', () => {
    const low = computeDetailedTax(base({ annualRegularWages: 40_000 }));
    const high = computeDetailedTax(base({ annualRegularWages: 200_000 }));
    expect(high.effectiveTaxRate).toBeGreaterThan(low.effectiveTaxRate);
  });

  it('identifies the correct marginal bracket for mid-range income', () => {
    // $60k regular − $16,100 std = $43,900 taxable → 12 % bracket
    const res = computeDetailedTax(base());
    expect(res.marginalBracketRate).toBe(0.12);
  });

  it('marginal bracket reaches 22% at ~$75k single', () => {
    // $75k − $16,100 = $58,900 → falls in 22% bracket (starts $50,400)
    const res = computeDetailedTax(base({ annualRegularWages: 75_000 }));
    expect(res.marginalBracketRate).toBe(0.22);
  });
});

// ─── FICA ─────────────────────────────────────────────────────────────────────

describe('FICA', () => {
  it('Social Security is 6.2% of gross W-2 wages up to the wage base', () => {
    const res = computeDetailedTax(base({ annualRegularWages: 50_000 }));
    expect(res.socialSecurityTax).toBeCloseTo(50_000 * 0.062, 2);
  });

  it('Social Security caps at the wage base ($184,500)', () => {
    const res = computeDetailedTax(base({ annualRegularWages: 220_000 }));
    expect(res.socialSecurityTax).toBeCloseTo(184_500 * 0.062, 2);
  });

  it('prior-year SS wages reduce remaining SS tax base', () => {
    const res = computeDetailedTax(base({
      annualRegularWages: 50_000,
      socialSecurityWagesBeforePeriod: 180_000,
    }));
    // Only 4,500 = 184,500 − 180,000 remains
    expect(res.socialSecurityTax).toBeCloseTo(4_500 * 0.062, 2);
  });

  it('Medicare is 1.45% of all W-2 wages (no cap)', () => {
    const res = computeDetailedTax(base({ annualRegularWages: 200_000 }));
    expect(res.medicareTax).toBeCloseTo(200_000 * 0.0145, 2);
  });

  it('additional Medicare applies above $200k for single filers', () => {
    const res = computeDetailedTax(base({ annualRegularWages: 210_000 }));
    expect(res.additionalMedicareTax).toBeCloseTo(10_000 * 0.009, 5);
  });

  it('additional Medicare threshold is $250k for MFJ', () => {
    const below = computeDetailedTax(joint({ annualRegularWages: 249_000 }));
    const above = computeDetailedTax(joint({ annualRegularWages: 260_000 }));
    expect(below.additionalMedicareTax).toBe(0);
    expect(above.additionalMedicareTax).toBeCloseTo(10_000 * 0.009, 5);
  });

  it('additional Medicare threshold is $125k for MFS', () => {
    const res = computeDetailedTax({
      ...blankDetailedInput('Married Filing Separately', 'OK', 'Weekly'),
      annualRegularWages: 135_000,
    });
    expect(res.additionalMedicareTax).toBeCloseTo(10_000 * 0.009, 5);
  });

  it('health insurance premiums reduce FICA wages (Section 125)', () => {
    const without = computeDetailedTax(base({ annualRegularWages: 60_000 }));
    const with_ = computeDetailedTax(base({ annualRegularWages: 60_000, annualHealthInsurancePremiums: 3_000 }));
    // SS + Medicare should be reduced by 3,000 × (6.2% + 1.45%)
    const ficaDiff = without.socialSecurityTax + without.medicareTax
      - (with_.socialSecurityTax + with_.medicareTax);
    expect(ficaDiff).toBeCloseTo(3_000 * (0.062 + 0.0145), 1);
  });

  it('traditional 401(k) does NOT reduce FICA wages', () => {
    const without = computeDetailedTax(base({ annualRegularWages: 60_000 }));
    const with_ = computeDetailedTax(base({ annualRegularWages: 60_000, annualTraditional401k: 10_000 }));
    // FICA should be the same
    expect(with_.socialSecurityTax).toBeCloseTo(without.socialSecurityTax, 1);
    expect(with_.medicareTax).toBeCloseTo(without.medicareTax, 1);
  });
});

// ─── Pre-tax deductions ───────────────────────────────────────────────────────

describe('pre-tax deductions', () => {
  it('traditional 401(k) reduces federal taxable income', () => {
    const without = computeDetailedTax(base());
    const with_ = computeDetailedTax(base({ annualTraditional401k: 5_000 }));
    expect(with_.federalTaxableIncome).toBeCloseTo(without.federalTaxableIncome - 5_000, 0);
    expect(with_.federalIncomeTax).toBeLessThan(without.federalIncomeTax);
  });

  it('Roth 401(k) does NOT reduce federal taxable income', () => {
    const without = computeDetailedTax(base());
    const with_ = computeDetailedTax(base({ annualRoth401k: 5_000 }));
    // Roth doesn't appear in the engine's income reduction
    expect(with_.federalTaxableIncome).toBeCloseTo(without.federalTaxableIncome, 0);
  });

  it('HSA contributions reduce both income tax and FICA wages', () => {
    const without = computeDetailedTax(base());
    const with_ = computeDetailedTax(base({ annualHSA: 3_000 }));
    // Income tax reduced
    expect(with_.federalIncomeTax).toBeLessThan(without.federalIncomeTax);
    // FICA reduced
    const ficaBefore = without.socialSecurityTax + without.medicareTax;
    const ficaAfter = with_.socialSecurityTax + with_.medicareTax;
    expect(ficaAfter).toBeLessThan(ficaBefore);
  });

  it('health insurance premiums reduce income tax and FICA', () => {
    const without = computeDetailedTax(base());
    const with_ = computeDetailedTax(base({ annualHealthInsurancePremiums: 4_800 }));
    expect(with_.federalIncomeTax).toBeLessThan(without.federalIncomeTax);
    expect(with_.socialSecurityTax).toBeLessThan(without.socialSecurityTax);
  });

  it('warns when 401(k) exceeds the 2026 limit', () => {
    const res = computeDetailedTax(base({ annualTraditional401k: 30_000 }));
    expect(res.warnings.some(w => w.includes('limit'))).toBe(true);
  });
});

// ─── Traditional IRA deductibility ───────────────────────────────────────────

describe('traditional IRA deductibility', () => {
  it('is fully deductible when not covered by employer plan', () => {
    const res = computeDetailedTax(base({
      annualTraditionalIRA: 7_000,
      coveredByEmployerPlan: false,
    }));
    expect(res.traditionalIRADeduction).toBe(7_000);
  });

  it('phases out at $79k–$89k MAGI for single covered by employer plan', () => {
    const at80k = computeDetailedTax(base({
      annualRegularWages: 80_000,
      annualTraditionalIRA: 7_000,
      coveredByEmployerPlan: true,
    }));
    const at90k = computeDetailedTax(base({
      annualRegularWages: 90_000,
      annualTraditionalIRA: 7_000,
      coveredByEmployerPlan: true,
    }));
    expect(at80k.traditionalIRADeduction).toBeGreaterThan(0);
    expect(at90k.traditionalIRADeduction).toBe(0);
  });

  it('is not deductible above the phase-out end for MFJ', () => {
    const res = computeDetailedTax({
      ...blankDetailedInput('Married Filing Jointly', 'OK', 'Weekly'),
      annualRegularWages: 150_000,
      annualTraditionalIRA: 7_000,
      coveredByEmployerPlan: true,
    });
    expect(res.traditionalIRADeduction).toBe(0);
  });
});

// ─── Child tax credit ─────────────────────────────────────────────────────────

describe('child tax credit', () => {
  it('gives $2,000 per qualifying child below phase-out', () => {
    const res = computeDetailedTax(base({
      annualRegularWages: 100_000,
      qualifyingChildren: 2,
    }));
    expect(res.childTaxCredit).toBe(4_000);
  });

  it('phases out above $200k MAGI for single filers', () => {
    const res = computeDetailedTax(base({
      annualRegularWages: 205_000,
      qualifyingChildren: 1,
    }));
    // $5k over threshold → $5 × $50 = $250 reduction → credit = $1,750
    expect(res.childTaxCredit).toBeLessThan(2_000);
  });

  it('gives $500 per other dependent', () => {
    const res = computeDetailedTax(base({
      annualRegularWages: 80_000,
      otherDependents: 3,
    }));
    expect(res.otherDependentCredit).toBe(1_500);
  });

  it('credit cannot reduce tax below zero', () => {
    const res = computeDetailedTax(base({
      annualRegularWages: 20_000,
      qualifyingChildren: 5,
    }));
    expect(res.federalIncomeTax).toBeGreaterThanOrEqual(0);
  });
});

// ─── Qualified overtime deduction (2026) ─────────────────────────────────────

describe('qualified overtime deduction', () => {
  it('deducts the FLSA premium (not all overtime wages)', () => {
    const res = computeDetailedTax(base({
      annualRegularWages: 50_000,
      annualOvertimeWages: 15_000,
      annualQualifiedOvertimePremium: 5_000,
    }));
    expect(res.qualifiedOvertimeDeduction).toBe(5_000);
  });

  it('caps at $12,500 for single filers', () => {
    const res = computeDetailedTax(base({
      annualRegularWages: 60_000,
      annualOvertimeWages: 30_000,
      annualQualifiedOvertimePremium: 20_000,
    }));
    expect(res.qualifiedOvertimeDeduction).toBe(12_500);
  });

  it('caps at $25,000 for MFJ', () => {
    const res = computeDetailedTax(joint({
      annualOvertimeWages: 60_000,
      annualQualifiedOvertimePremium: 30_000,
    }));
    expect(res.qualifiedOvertimeDeduction).toBe(25_000);
  });

  it('not available for Married Filing Separately', () => {
    const res = computeDetailedTax({
      ...blankDetailedInput('Married Filing Separately', 'OK', 'Weekly'),
      annualRegularWages: 50_000,
      annualOvertimeWages: 10_000,
      annualQualifiedOvertimePremium: 3_000,
    });
    expect(res.qualifiedOvertimeDeduction).toBe(0);
    expect(res.warnings.some(w => w.includes('Married Filing Separately'))).toBe(true);
  });

  it('phases out at 10 cents per dollar above $150k for single', () => {
    const res = computeDetailedTax(base({
      annualRegularWages: 160_000,
      annualOvertimeWages: 20_000,
      annualQualifiedOvertimePremium: 8_000,
    }));
    // AGI ≈ 180,000 − 16,100 std; phaseout on AGI above 150k
    // Eligible = min(8,000, 20,000, 12,500) = 8,000
    // phaseout ≈ (AGI − 150k) × 0.10 — deduction will be reduced but > 0
    expect(res.qualifiedOvertimeDeduction).toBeGreaterThan(0);
    expect(res.qualifiedOvertimeDeduction).toBeLessThan(8_000);
  });
});

// ─── Overtime incremental ─────────────────────────────────────────────────────

describe('overtime incremental tax', () => {
  it('overtime incremental tax is positive when overtime is worked', () => {
    const res = computeDetailedTax(base({
      annualOvertimeWages: 10_000,
      annualQualifiedOvertimePremium: 3_000,
    }));
    expect(res.overtimeIncrementalTax).toBeGreaterThan(0);
    expect(res.overtimeEffectiveTaxRate).not.toBeNull();
  });

  it('no overtime produces zero incremental tax and null rate', () => {
    const res = computeDetailedTax(base());
    expect(res.overtimeIncrementalTax).toBe(0);
    expect(res.overtimeEffectiveTaxRate).toBeNull();
  });

  it('estimated after-tax overtime = overtime wages − incremental tax', () => {
    const ot = 12_000;
    const res = computeDetailedTax(base({
      annualOvertimeWages: ot,
      annualQualifiedOvertimePremium: 4_000,
    }));
    expect(res.estimatedAfterTaxOvertime).toBeCloseTo(
      ot - res.overtimeIncrementalTax, 0,
    );
  });

  it('irregular storm week OT is handled like regular OT (no special rate)', () => {
    const normal = computeDetailedTax(base({ annualOvertimeWages: 5_000, annualQualifiedOvertimePremium: 1_500 }));
    const storm  = computeDetailedTax(base({ annualOvertimeWages: 30_000, annualQualifiedOvertimePremium: 10_000 }));
    // Both have positive incremental OT tax; storm week pushes into higher bracket
    expect(storm.overtimeIncrementalTax).toBeGreaterThan(normal.overtimeIncrementalTax);
  });
});

// ─── Per diem ─────────────────────────────────────────────────────────────────

describe('per diem', () => {
  it('non-taxable per diem does not appear in gross wages', () => {
    const without = computeDetailedTax(base());
    const with_ = computeDetailedTax(base({ annualNonTaxablePerDiem: 5_000 }));
    // Non-taxable per diem should not change taxable income
    expect(with_.grossW2Wages).toBeCloseTo(without.grossW2Wages, 0);
    expect(with_.federalTaxableIncome).toBeCloseTo(without.federalTaxableIncome, 0);
  });

  it('taxable per diem increases gross wages and federal tax', () => {
    const without = computeDetailedTax(base());
    const with_ = computeDetailedTax(base({ annualTaxablePerDiem: 3_000 }));
    expect(with_.grossW2Wages).toBeCloseTo(without.grossW2Wages + 3_000, 0);
    expect(with_.federalIncomeTax).toBeGreaterThan(without.federalIncomeTax);
  });
});

// ─── 1099 / Self-employment income ────────────────────────────────────────────

describe('1099 self-employment income', () => {
  it('SE tax is 15.3% on 92.35% of net SE income', () => {
    const seIncome = 50_000;
    const res = computeDetailedTax({
      ...blankDetailedInput('Single', '', 'Weekly'),
      annual1099Income: seIncome,
    });
    expect(res.seTax).toBeCloseTo(seIncome * 0.9235 * 0.153, 1);
  });

  it('half of SE tax is deductible above the line', () => {
    const seIncome = 40_000;
    const res = computeDetailedTax({
      ...blankDetailedInput('Single', '', 'Weekly'),
      annual1099Income: seIncome,
    });
    expect(res.seTaxDeduction).toBeCloseTo(res.seTax / 2, 1);
  });

  it('1099 expenses reduce SE taxable income', () => {
    const noExp = computeDetailedTax({
      ...blankDetailedInput('Single', '', 'Weekly'),
      annual1099Income: 50_000,
    });
    const withExp = computeDetailedTax({
      ...blankDetailedInput('Single', '', 'Weekly'),
      annual1099Income: 50_000,
      annual1099Expenses: 10_000,
    });
    expect(withExp.netSEIncome).toBe(40_000);
    expect(withExp.seTax).toBeLessThan(noExp.seTax);
  });

  it('combined W-2 + 1099 income aggregates correctly', () => {
    const res = computeDetailedTax({
      ...blankDetailedInput('Single', 'OK', 'Weekly'),
      annualRegularWages: 40_000,
      annual1099Income: 20_000,
    });
    expect(res.grossW2Wages).toBe(40_000);
    expect(res.grossSEIncome).toBe(20_000);
    expect(res.totalGrossIncome).toBe(60_000);
  });

  it('shows 1099 expense opportunity warning when no expenses entered', () => {
    const res = computeDetailedTax({
      ...blankDetailedInput('Single', '', 'Weekly'),
      annual1099Income: 30_000,
    });
    expect(res.taxSavingOpportunities.some(o => o.title.includes('Schedule C'))).toBe(true);
  });
});

// ─── Multiple jobs ────────────────────────────────────────────────────────────

describe('multiple jobs', () => {
  it('second job wages are included in gross W-2 and taxed', () => {
    const one = computeDetailedTax(base({ annualRegularWages: 40_000 }));
    const two = computeDetailedTax(base({ annualRegularWages: 40_000, secondJobAnnualWages: 20_000 }));
    expect(two.grossW2Wages).toBe(60_000);
    expect(two.federalIncomeTax).toBeGreaterThan(one.federalIncomeTax);
  });

  it('spouse wages are included for MFJ filers', () => {
    const alone = computeDetailedTax(joint());
    const combined = computeDetailedTax(joint({ spouseAnnualWages: 40_000 }));
    expect(combined.grossW2Wages).toBe(alone.grossW2Wages + 40_000);
  });

  it('multiple income streams push into higher brackets', () => {
    const single = computeDetailedTax(base({ annualRegularWages: 50_000 }));
    const multi  = computeDetailedTax(base({ annualRegularWages: 50_000, secondJobAnnualWages: 50_000 }));
    expect(multi.marginalBracketRate).toBeGreaterThanOrEqual(single.marginalBracketRate);
  });
});

// ─── Oklahoma state tax ───────────────────────────────────────────────────────

describe('Oklahoma state income tax', () => {
  it('calculates state tax for OK residents', () => {
    const res = computeDetailedTax(base({ annualRegularWages: 60_000 }));
    expect(res.stateIncomeTax).not.toBeNull();
    expect(res.stateIncomeTax!).toBeGreaterThan(0);
  });

  it('state tax is null for unsupported states', () => {
    const res = computeDetailedTax({
      ...blankDetailedInput('Single', 'TX', 'Weekly'),
      annualRegularWages: 60_000,
    });
    expect(res.stateIncomeTax).toBeNull();
    expect(res.warnings.some(w => w.includes('TX'))).toBe(true);
  });

  it('state tax is null and no warning for empty state', () => {
    const res = computeDetailedTax({
      ...blankDetailedInput('Single', '', 'Weekly'),
      annualRegularWages: 60_000,
    });
    expect(res.stateIncomeTax).toBeNull();
    expect(res.warnings.every(w => !w.includes('not yet calculated'))).toBe(true);
  });
});

// ─── Refund / Amount Owed ─────────────────────────────────────────────────────

describe('refund / amount owed', () => {
  it('returns null when no YTD withholding is entered', () => {
    const res = computeDetailedTax(base());
    expect(res.estimatedRefundOrOwed).toBeNull();
  });

  it('positive value = estimated refund when withheld > liability', () => {
    const res = computeDetailedTax(base({
      annualRegularWages: 60_000,
      ytdFederalWithheld: 15_000,
      ytdSocialSecurityWithheld: 3_720,
      ytdMedicareWithheld: 870,
    }));
    expect(res.estimatedRefundOrOwed).not.toBeNull();
    // With $19,590 withheld and ~$9k+ total tax, expect a refund
    expect(res.estimatedRefundOrOwed!).toBeGreaterThan(0);
  });

  it('negative value = amount owed when withheld < liability', () => {
    const res = computeDetailedTax(base({
      annualRegularWages: 150_000,
      ytdFederalWithheld: 5_000, // intentionally under-withheld
      ytdSocialSecurityWithheld: 100,
      ytdMedicareWithheld: 100,
    }));
    expect(res.estimatedRefundOrOwed!).toBeLessThan(0);
  });

  it('remaining tax per period is computed when YTD is present', () => {
    const res = computeDetailedTax(base({
      annualRegularWages: 60_000,
      ytdFederalWithheld: 3_000,
      ytdSocialSecurityWithheld: 1_000,
      ytdMedicareWithheld: 300,
      ytdGrossPay: 30_000,
    }));
    expect(res.estimatedRemainingTaxPerPeriod).not.toBeNull();
    expect(res.estimatedRemainingTaxPerPeriod!).toBeGreaterThanOrEqual(0);
  });

  it('remaining periods calculation is always ≥ 1', () => {
    const res = computeDetailedTax(base({
      annualRegularWages: 60_000,
      ytdFederalWithheld: 1,
      ytdGrossPay: 55_000, // almost all year elapsed
    }));
    expect(res.remainingPeriods).toBeGreaterThanOrEqual(1);
  });
});

// ─── Confidence scoring ───────────────────────────────────────────────────────

describe('confidence scoring', () => {
  it('high confidence when wages + filing + YTD all provided', () => {
    const res = computeDetailedTax(base({
      annualRegularWages: 60_000,
      ytdFederalWithheld: 10_000,
      ytdSocialSecurityWithheld: 3_720,
    }));
    expect(res.confidenceLevel).toBe('high');
    expect(res.confidenceScore).toBeGreaterThanOrEqual(75);
  });

  it('medium confidence with wages and filing but no YTD', () => {
    const res = computeDetailedTax(base());
    expect(['medium', 'high']).toContain(res.confidenceLevel);
  });

  it('low confidence with no income entered', () => {
    const res = computeDetailedTax({
      ...blankDetailedInput('Single', '', 'Weekly'),
    });
    expect(res.confidenceLevel).toBe('low');
  });
});

// ─── Quick estimate builder ───────────────────────────────────────────────────

describe('buildQuickEstimateInput', () => {
  const stubs = [
    { regularHours: 40, overtimeHours: 8, doubleTimeHours: 0, perDiem: 100, grossPay: 1_600, taxes: 320 },
    { regularHours: 40, overtimeHours: 4, doubleTimeHours: 0, perDiem: 100, grossPay: 1_400, taxes: 280 },
  ];

  it('annualises from paystubs using the pay frequency multiplier', () => {
    const input = buildQuickEstimateInput({
      paystubs: stubs,
      hourlyRate: 35,
      payFrequency: 'Weekly',
      filingStatus: 'Single',
      stateCode: 'OK',
      qualifyingChildren: 0,
      otherDependents: 0,
      annualPreTaxDeductions: 0,
      additionalAnnualTaxableIncome: 0,
      additionalTaxablePerDiem: 0,
    });
    // Average reg hours = 40, OT = 6; annualised at 52 weeks
    expect(input.annualRegularWages).toBeCloseTo(40 * 35 * 52, 0);
    expect(input.annualOvertimeWages).toBeCloseTo(6 * 35 * 1.5 * 52, 0);
  });

  it('treats paystub per diem as non-taxable (all)', () => {
    const input = buildQuickEstimateInput({
      paystubs: stubs,
      hourlyRate: 35,
      payFrequency: 'Weekly',
      filingStatus: 'Single',
      stateCode: 'OK',
      qualifyingChildren: 0,
      otherDependents: 0,
      annualPreTaxDeductions: 0,
      additionalAnnualTaxableIncome: 0,
      additionalTaxablePerDiem: 0,
    });
    expect(input.annualNonTaxablePerDiem).toBeCloseTo(100 * 52, 0);
    expect(input.annualTaxablePerDiem).toBe(0);
  });

  it('falls back to grossPay annualisation when hourlyRate is 0', () => {
    const input = buildQuickEstimateInput({
      paystubs: stubs,
      hourlyRate: 0,
      payFrequency: 'Weekly',
      filingStatus: 'Single',
      stateCode: 'OK',
      qualifyingChildren: 0,
      otherDependents: 0,
      annualPreTaxDeductions: 0,
      additionalAnnualTaxableIncome: 0,
      additionalTaxablePerDiem: 0,
    });
    // grossPay average = 1,500; subtract per diem 100 → 1,400/wk; 1,400 × 52 = 72,800
    expect(input.annualRegularWages).toBeCloseTo(1_400 * 52, 0);
    expect(input.annualOvertimeWages).toBe(0);
  });

  it('produces a computable result from quick input', () => {
    const input = buildQuickEstimateInput({
      paystubs: stubs,
      hourlyRate: 35,
      payFrequency: 'Weekly',
      filingStatus: 'Single',
      stateCode: 'OK',
      qualifyingChildren: 0,
      otherDependents: 0,
      annualPreTaxDeductions: 2_400,
      additionalAnnualTaxableIncome: 0,
      additionalTaxablePerDiem: 0,
    });
    const res = computeDetailedTax(input);
    expect(res.totalEstimatedTax).toBeGreaterThan(0);
    expect(res.stateIncomeTax).not.toBeNull();
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('zero income produces zero tax', () => {
    const res = computeDetailedTax(blankDetailedInput('Single', 'OK', 'Weekly'));
    expect(res.totalEstimatedTax).toBe(0);
    expect(res.federalIncomeTax).toBe(0);
    expect(res.socialSecurityTax).toBe(0);
  });

  it('negative inputs are clamped to zero (no negative tax)', () => {
    const res = computeDetailedTax(base({ annualRegularWages: -5_000 }));
    expect(res.grossW2Wages).toBeGreaterThanOrEqual(0);
    expect(res.totalEstimatedTax).toBeGreaterThanOrEqual(0);
  });

  it('all income from 1099 (no W-2) computes SE tax correctly', () => {
    const res = computeDetailedTax({
      ...blankDetailedInput('Single', 'OK', 'Weekly'),
      annual1099Income: 80_000,
      annual1099Expenses: 10_000,
    });
    expect(res.grossW2Wages).toBe(0);
    expect(res.seTax).toBeCloseTo(70_000 * 0.9235 * 0.153, 1);
  });

  it('maximum 401(k) contribution ($23,500) produces correct deduction', () => {
    const res = computeDetailedTax(base({
      annualRegularWages: 80_000,
      annualTraditional401k: 23_500,
    }));
    // No warning, full deduction applied
    expect(res.warnings.every(w => !w.includes('limit'))).toBe(true);
    // 401k reduces income but NOT SS/Medicare
    expect(res.totalPreTaxDeductions).toBeGreaterThanOrEqual(23_500);
  });

  it('effective tax rate is between 0 and 1', () => {
    const cases: FilingStatus[] = [
      'Single', 'Married Filing Jointly',
      'Married Filing Separately', 'Head of Household',
    ];
    for (const fs of cases) {
      const res = computeDetailedTax({
        ...blankDetailedInput(fs, 'OK', 'Weekly'),
        annualRegularWages: 90_000,
      });
      expect(res.effectiveTaxRate).toBeGreaterThan(0);
      expect(res.effectiveTaxRate).toBeLessThan(1);
    }
  });

  it('monthly figures are annual / 12', () => {
    const res = computeDetailedTax(base({ annualRegularWages: 72_000 }));
    expect(res.monthlyFederalTax).toBeCloseTo(res.federalIncomeTax / 12, 2);
    expect(res.monthlyFICA).toBeCloseTo(
      (res.socialSecurityTax + res.medicareTax + res.additionalMedicareTax + res.seTax) / 12,
      2,
    );
  });

  it('biweekly pay produces 26 periods per year', () => {
    const res = computeDetailedTax({
      ...blankDetailedInput('Single', 'OK', 'Bi-Weekly'),
      annualRegularWages: 52_000,
    });
    expect(res.periodsPerYear).toBe(26);
  });

  it('semimonthly pay produces 24 periods per year', () => {
    const res = computeDetailedTax({
      ...blankDetailedInput('Single', 'OK', 'Semi-Monthly'),
      annualRegularWages: 48_000,
    });
    expect(res.periodsPerYear).toBe(24);
  });
});
