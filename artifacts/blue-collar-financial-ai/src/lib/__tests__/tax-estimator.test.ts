import { describe, it, expect } from 'vitest';
import { estimateWageAndOvertimeTax, progressiveTax } from '../tax-estimator';

describe('tax-estimator', () => {
  it('progressive brackets tax only the income inside each layer', () => {
    expect(progressiveTax(12_400, [{ upTo: 12_400, rate: 0.10 }, { upTo: null, rate: 0.20 }])).toBe(1_240);
    expect(progressiveTax(22_400, [{ upTo: 12_400, rate: 0.10 }, { upTo: null, rate: 0.20 }])).toBe(3_240);
  });

  it('overtime is not assigned a flat special tax rate', () => {
    const estimate = estimateWageAndOvertimeTax({
      filingStatus: 'Single', stateCode: 'OK', annualRegularWages: 65_000,
      annualOvertimeWages: 15_000, annualQualifiedOvertimePremium: 5_000,
    });
    expect(estimate.overtimeEffectiveTaxRate).not.toBeNull();
    expect(estimate.overtimeEffectiveTaxRate ?? 0).toBeGreaterThan(0);
    expect(estimate.overtimeEffectiveTaxRate ?? 1).toBeLessThan(1);
    expect(estimate.qualifiedOvertimeDeduction).toBe(5_000);
  });

  it('only the qualified premium is deductible, not all overtime wages', () => {
    const estimate = estimateWageAndOvertimeTax({
      filingStatus: 'Single', stateCode: 'OK', annualRegularWages: 60_000,
      annualOvertimeWages: 18_000, annualQualifiedOvertimePremium: 6_000,
    });
    expect(estimate.qualifiedOvertimeDeduction).toBe(6_000);
  });

  it('qualified overtime deduction respects annual cap', () => {
    const single = estimateWageAndOvertimeTax({
      filingStatus: 'Single', stateCode: 'OK', annualRegularWages: 80_000,
      annualOvertimeWages: 40_000, annualQualifiedOvertimePremium: 20_000,
    });
    const joint = estimateWageAndOvertimeTax({
      filingStatus: 'Married Filing Jointly', stateCode: 'OK', annualRegularWages: 80_000,
      annualOvertimeWages: 60_000, annualQualifiedOvertimePremium: 30_000,
    });
    expect(single.qualifiedOvertimeDeduction).toBe(12_500);
    expect(joint.qualifiedOvertimeDeduction).toBe(25_000);
  });

  it('married filing separately does not claim the overtime deduction', () => {
    const estimate = estimateWageAndOvertimeTax({
      filingStatus: 'Married Filing Separately', stateCode: 'OK', annualRegularWages: 60_000,
      annualOvertimeWages: 12_000, annualQualifiedOvertimePremium: 4_000,
    });
    expect(estimate.qualifiedOvertimeDeduction).toBe(0);
    expect(estimate.warnings.some((w) => w.includes('file jointly'))).toBe(true);
  });

  it('payroll taxes remain applicable to overtime', () => {
    const estimate = estimateWageAndOvertimeTax({
      filingStatus: 'Single', stateCode: 'OK', annualRegularWages: 40_000,
      annualOvertimeWages: 10_000, annualQualifiedOvertimePremium: 3_000,
    });
    expect(estimate.socialSecurityTax).toBe(50_000 * 0.062);
    expect(estimate.medicareTax).toBe(50_000 * 0.0145);
  });

  it('social security tax stops at the 2026 wage base', () => {
    const estimate = estimateWageAndOvertimeTax({
      filingStatus: 'Single', stateCode: 'OK', annualRegularWages: 20_000,
      annualOvertimeWages: 5_000, annualQualifiedOvertimePremium: 1_000,
      socialSecurityWagesBeforePeriod: 180_000,
    });
    expect(estimate.socialSecurityTax).toBe(4_500 * 0.062);
  });

  it('unsupported states return a clear incomplete estimate', () => {
    const estimate = estimateWageAndOvertimeTax({
      filingStatus: 'Single', stateCode: 'TX', annualRegularWages: 50_000,
      annualOvertimeWages: 0, annualQualifiedOvertimePremium: 0,
    });
    expect(estimate.stateIncomeTax).toBeNull();
    expect(estimate.warnings.some((w) => w.includes('not yet calculated'))).toBe(true);
  });

  it('no overtime produces zero incremental tax and null OT rate', () => {
    const estimate = estimateWageAndOvertimeTax({
      filingStatus: 'Single', stateCode: 'OK', annualRegularWages: 55_000,
      annualOvertimeWages: 0, annualQualifiedOvertimePremium: 0,
    });
    expect(estimate.overtimeIncrementalTax).toBe(0);
    expect(estimate.overtimeEffectiveTaxRate).toBeNull();
    expect(estimate.estimatedAfterTaxOvertime).toBe(0);
  });

  it('pretax deductions reduce federal taxable income', () => {
    const without = estimateWageAndOvertimeTax({
      filingStatus: 'Single', stateCode: 'OK', annualRegularWages: 60_000,
      annualOvertimeWages: 0, annualQualifiedOvertimePremium: 0,
    });
    const withDeductions = estimateWageAndOvertimeTax({
      filingStatus: 'Single', stateCode: 'OK', annualRegularWages: 60_000,
      annualOvertimeWages: 0, annualQualifiedOvertimePremium: 0,
      annualPretaxDeductions: 5_000,
    });
    expect(withDeductions.federalIncomeTax).toBeLessThan(without.federalIncomeTax);
    expect(withDeductions.federalTaxableIncome).toBe(without.federalTaxableIncome - 5_000);
  });

  it('additional Medicare threshold triggers at $200k', () => {
    const estimate = estimateWageAndOvertimeTax({
      filingStatus: 'Single', stateCode: 'OK', annualRegularWages: 210_000,
      annualOvertimeWages: 0, annualQualifiedOvertimePremium: 0,
    });
    expect(estimate.additionalMedicareTax).toBeGreaterThan(0);
    expect(estimate.additionalMedicareTax).toBeCloseTo(10_000 * 0.009, 5);
  });

  it('qualified overtime premium is capped at total overtime wages', () => {
    const estimate = estimateWageAndOvertimeTax({
      filingStatus: 'Single', stateCode: 'OK', annualRegularWages: 50_000,
      annualOvertimeWages: 5_000, annualQualifiedOvertimePremium: 8_000,
    });
    // Premium cannot exceed wages
    expect(estimate.qualifiedOvertimeDeduction).toBeLessThanOrEqual(5_000);
    expect(estimate.warnings.some((w) => w.includes('capped'))).toBe(true);
  });
});
