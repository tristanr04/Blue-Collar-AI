import assert from "node:assert/strict";
import test from "node:test";
import { insertProfileContextSchema, US_STATE_CODES } from "../profile-context";

test("accepts supported state and tax profile values", () => {
  const parsed = insertProfileContextSchema.parse({
    birthDate: "2004-03-15",
    stateCode: "OK",
    taxFilingStatus: "Single",
    qualifyingChildren: 0,
    otherDependents: 0,
    spouseHasIncome: false,
    additionalAnnualIncome: 0,
    annualPreTaxDeductions: 12_000,
  });

  assert.equal(parsed.stateCode, "OK");
  assert.equal(parsed.birthDate, "2004-03-15");
});

test("supports all states and DC", () => {
  assert.equal(US_STATE_CODES.length, 51);
  assert.ok(US_STATE_CODES.includes("OK"));
  assert.ok(US_STATE_CODES.includes("DC"));
});

test("rejects invalid state codes", () => {
  const result = insertProfileContextSchema.safeParse({
    stateCode: "XX",
    taxFilingStatus: "Single",
    qualifyingChildren: 0,
    otherDependents: 0,
    spouseHasIncome: false,
    additionalAnnualIncome: 0,
    annualPreTaxDeductions: 0,
  });
  assert.equal(result.success, false);
});

test("rejects future and under-18 birth dates", () => {
  for (const birthDate of ["2099-01-01", "2015-01-01"]) {
    const result = insertProfileContextSchema.safeParse({
      birthDate,
      stateCode: "OK",
      taxFilingStatus: "Single",
      qualifyingChildren: 0,
      otherDependents: 0,
      spouseHasIncome: false,
      additionalAnnualIncome: 0,
      annualPreTaxDeductions: 0,
    });
    assert.equal(result.success, false);
  }
});

test("rejects impossible dependent and deduction values", () => {
  const result = insertProfileContextSchema.safeParse({
    stateCode: "OK",
    taxFilingStatus: "Single",
    qualifyingChildren: -1,
    otherDependents: 0,
    spouseHasIncome: false,
    additionalAnnualIncome: -100,
    annualPreTaxDeductions: -1,
  });
  assert.equal(result.success, false);
});
