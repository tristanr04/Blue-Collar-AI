/**
 * Unit tests for vehicle-loan extraction normalization (Phase 11 test spec).
 *
 * These are white-box tests of the normalizeVehicleLoanExtraction logic.
 * We replicate the functions here because they are not exported from scan.ts.
 * Any change to the normalization logic must be reflected here too.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ─── Replicated normalization helpers (keep in sync with scan.ts) ─────────────

function firstDefined(...values: unknown[]): unknown {
  return values.find((v) => v !== undefined && v !== null && v !== "") ?? null;
}

function parseMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[$,\s]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseApr(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string") return null;
  const match = value.match(/\d+/);
  if (!match) return null;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getLast4(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/[^a-zA-Z0-9]/g, "").trim();
  return cleaned.length >= 4 ? cleaned.slice(-4) : cleaned || null;
}

function normalizeVehicleLoanExtraction(raw: Record<string, unknown>) {
  return {
    loanName: firstDefined(
      raw.loanName, raw.lenderName, raw.lender, raw.creditor,
      raw.financeCompany, raw.servicer, raw.companyName,
    ) as string | null,

    accountLast4: getLast4(firstDefined(
      raw.accountLast4, raw.last4, raw.lastFourDigits,
      raw.accountNumber, raw.accountId, raw.loanNumber, raw.contractNumber,
    )),

    balanceOwed: parseMoney(firstDefined(
      raw.balanceOwed, raw.remainingBalance, raw.currentBalance,
      raw.principalBalance, raw.payoffBalance, raw.amountOwed,
    )),

    originalAmount: parseMoney(firstDefined(
      raw.originalAmount, raw.originalLoanAmount, raw.amountFinanced,
      raw.initialPrincipal, raw.loanAmount,
    )),

    apr: parseApr(firstDefined(
      raw.apr, raw.interestRate, raw.annualPercentageRate, raw.rate,
    )),

    monthlyPayment: parseMoney(firstDefined(
      raw.monthlyPayment, raw.regularPayment, raw.scheduledPayment,
      raw.paymentAmount, raw.amountDue,
    )),

    monthsRemaining: parseInteger(firstDefined(
      raw.monthsRemaining, raw.remainingMonths, raw.remainingTerm,
      raw.paymentsRemaining, raw.monthsLeft,
    )),

    nextDueDate: firstDefined(
      raw.nextDueDate, raw.paymentDueDate, raw.nextPaymentDate, raw.dueDate,
    ) as string | null,

    confidence: (raw.confidence as Record<string, number>) ?? {},
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("vehicle-loan normalisation", () => {
  // ── Phase-11 acceptance document ─────────────────────────────────────────
  // Simulates a document that uses alternate labels (the exact test spec
  // from the task file).
  it("Phase-11: maps alternate labels to canonical keys", () => {
    const raw: Record<string, unknown> = {
      // AI used alternate label names for this document
      lender: "Vehicle Payment Test Form",
      accountId: "TEST-VEH-0042",
      remainingBalance: "$19,432.58",
      loanAmount: "$36,500.00",
      interestRate: "8.49%",
      monthlyPayment: 687.21,
      remainingTerm: "72",
      paymentDueDate: "2026-08-15",
    };

    const result = normalizeVehicleLoanExtraction(raw);

    assert.equal(result.loanName, "Vehicle Payment Test Form");
    assert.equal(result.accountLast4, "0042");
    assert.equal(result.balanceOwed, 19432.58);
    assert.equal(result.originalAmount, 36500);
    assert.equal(result.apr, 8.49);
    assert.equal(result.monthlyPayment, 687.21);
    assert.equal(result.monthsRemaining, 72);
    assert.equal(result.nextDueDate, "2026-08-15");
  });

  // ── Canonical names pass through unchanged ────────────────────────────────
  it("canonical field names pass through without modification", () => {
    const raw: Record<string, unknown> = {
      loanName: "First National Auto",
      accountLast4: "7890",
      balanceOwed: 12000,
      originalAmount: 25000,
      apr: 5.99,
      monthlyPayment: 450,
      monthsRemaining: 36,
      nextDueDate: "2026-09-01",
    };

    const result = normalizeVehicleLoanExtraction(raw);

    assert.equal(result.loanName, "First National Auto");
    assert.equal(result.accountLast4, "7890");
    assert.equal(result.balanceOwed, 12000);
    assert.equal(result.originalAmount, 25000);
    assert.equal(result.apr, 5.99);
    assert.equal(result.monthlyPayment, 450);
    assert.equal(result.monthsRemaining, 36);
    assert.equal(result.nextDueDate, "2026-09-01");
  });

  // ── All fields absent → all null (no silent zeroes) ──────────────────────
  it("missing fields stay null — never default to zero", () => {
    const result = normalizeVehicleLoanExtraction({});

    assert.equal(result.loanName, null);
    assert.equal(result.accountLast4, null);
    assert.equal(result.balanceOwed, null);
    assert.equal(result.originalAmount, null);
    assert.equal(result.apr, null);
    assert.equal(result.monthlyPayment, null);
    assert.equal(result.monthsRemaining, null);
    assert.equal(result.nextDueDate, null);
  });

  // ── getLast4 ──────────────────────────────────────────────────────────────
  it("getLast4 extracts last 4 chars from a hyphenated account ID", () => {
    assert.equal(getLast4("TEST-VEH-0042"), "0042");
    assert.equal(getLast4("ACC-9876-5432"), "5432");
    assert.equal(getLast4("1234"), "1234");
    assert.equal(getLast4("12"), "12"); // shorter than 4 → return as-is
    assert.equal(getLast4(null), null);
    assert.equal(getLast4(undefined), null);
  });

  // ── parseMoney strips symbols ─────────────────────────────────────────────
  it("parseMoney handles currency strings with symbols and commas", () => {
    assert.equal(parseMoney("$19,432.58"), 19432.58);
    assert.equal(parseMoney("$36,500.00"), 36500);
    assert.equal(parseMoney(687.21), 687.21);
    assert.equal(parseMoney(null), null);
    assert.equal(parseMoney(""), null);
    assert.equal(parseMoney("not a number"), null);
  });

  // ── parseApr strips % sign ────────────────────────────────────────────────
  it("parseApr extracts numeric rate from strings with percent signs", () => {
    assert.equal(parseApr("8.49%"), 8.49);
    assert.equal(parseApr("5.99"), 5.99);
    assert.equal(parseApr(8.49), 8.49);
    assert.equal(parseApr(null), null);
    assert.equal(parseApr("not a rate"), null);
  });

  // ── parseInteger rounds floats ────────────────────────────────────────────
  it("parseInteger rounds float months and parses string months", () => {
    assert.equal(parseInteger("72"), 72);
    assert.equal(parseInteger(72.9), 73); // round
    assert.equal(parseInteger("48 months"), 48);
    assert.equal(parseInteger(null), null);
  });

  // ── Priority: canonical wins over fallback ────────────────────────────────
  it("canonical key takes priority over fallback aliases", () => {
    const raw: Record<string, unknown> = {
      balanceOwed: 5000,
      currentBalance: 9999, // should be ignored — balanceOwed is present
      apr: 4.5,
      interestRate: 9.9,    // should be ignored — apr is present
    };
    const result = normalizeVehicleLoanExtraction(raw);
    assert.equal(result.balanceOwed, 5000);
    assert.equal(result.apr, 4.5);
  });
});
