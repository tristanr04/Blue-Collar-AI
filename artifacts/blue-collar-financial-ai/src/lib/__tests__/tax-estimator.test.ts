import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateWageAndOvertimeTax, progressiveTax } from '../tax-estimator';

test('progressive brackets tax only the income inside each layer', () => {
  assert.equal(progressiveTax(12_400, [{ upTo: 12_400, rate: 0.10 }, { upTo: null, rate: 0.20 }]), 1_240);
  assert.equal(progressiveTax(22_400, [{ upTo: 12_400, rate: 0.10 }, { upTo: null, rate: 0.20 }]), 3_240);
});

test('overtime is not assigned a flat special tax rate', () => {
  const estimate = estimateWageAndOvertimeTax({
    filingStatus: 'Single', stateCode: 'OK', annualRegularWages: 65_000,
    annualOvertimeWages: 15_000, annualQualifiedOvertimePremium: 5_000,
  });
  assert.ok(estimate.overtimeEffectiveTaxRate !== null);
  assert.ok((estimate.overtimeEffectiveTaxRate ?? 0) > 0);
  assert.ok((estimate.overtimeEffectiveTaxRate ?? 1) < 1);
  assert.equal(estimate.qualifiedOvertimeDeduction, 5_000);
});

test('only the qualified premium is deductible, not all overtime wages', () => {
  const estimate = estimateWageAndOvertimeTax({
    filingStatus: 'Single', stateCode: 'OK', annualRegularWages: 60_000,
    annualOvertimeWages: 18_000, annualQualifiedOvertimePremium: 6_000,
  });
  assert.equal(estimate.qualifiedOvertimeDeduction, 6_000);
});

test('qualified overtime deduction respects annual cap', () => {
  const single = estimateWageAndOvertimeTax({
    filingStatus: 'Single', stateCode: 'OK', annualRegularWages: 80_000,
    annualOvertimeWages: 40_000, annualQualifiedOvertimePremium: 20_000,
  });
  const joint = estimateWageAndOvertimeTax({
    filingStatus: 'Married Filing Jointly', stateCode: 'OK', annualRegularWages: 80_000,
    annualOvertimeWages: 60_000, annualQualifiedOvertimePremium: 30_000,
  });
  assert.equal(single.qualifiedOvertimeDeduction, 12_500);
  assert.equal(joint.qualifiedOvertimeDeduction, 25_000);
});

test('married filing separately does not claim the overtime deduction', () => {
  const estimate = estimateWageAndOvertimeTax({
    filingStatus: 'Married Filing Separately', stateCode: 'OK', annualRegularWages: 60_000,
    annualOvertimeWages: 12_000, annualQualifiedOvertimePremium: 4_000,
  });
  assert.equal(estimate.qualifiedOvertimeDeduction, 0);
  assert.ok(estimate.warnings.some((warning) => warning.includes('file jointly')));
});

test('payroll taxes remain applicable to overtime', () => {
  const estimate = estimateWageAndOvertimeTax({
    filingStatus: 'Single', stateCode: 'OK', annualRegularWages: 40_000,
    annualOvertimeWages: 10_000, annualQualifiedOvertimePremium: 3_000,
  });
  assert.equal(estimate.socialSecurityTax, 50_000 * 0.062);
  assert.equal(estimate.medicareTax, 50_000 * 0.0145);
});

test('social security tax stops at the 2026 wage base', () => {
  const estimate = estimateWageAndOvertimeTax({
    filingStatus: 'Single', stateCode: 'OK', annualRegularWages: 20_000,
    annualOvertimeWages: 5_000, annualQualifiedOvertimePremium: 1_000,
    socialSecurityWagesBeforePeriod: 180_000,
  });
  assert.equal(estimate.socialSecurityTax, 4_500 * 0.062);
});

test('unsupported states return a clear incomplete estimate', () => {
  const estimate = estimateWageAndOvertimeTax({
    filingStatus: 'Single', stateCode: 'TX', annualRegularWages: 50_000,
    annualOvertimeWages: 0, annualQualifiedOvertimePremium: 0,
  });
  assert.equal(estimate.stateIncomeTax, null);
  assert.ok(estimate.warnings.some((warning) => warning.includes('not yet calculated')));
});
