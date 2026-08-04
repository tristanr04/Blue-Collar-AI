/**
 * Unit tests for vehicle-loan extraction normalization (Phase 11 test spec).
 *
 * These are white-box tests of the normalizeVehicleLoanExtraction,
 * flattenWrappedFields, and looksLikeVehicleLoan logic.
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

function unwrapFieldValue(value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "value" in value
  ) {
    return (value as { value?: unknown }).value ?? null;
  }
  return value;
}

function flattenWrappedFields(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const nestedFields =
    raw.fields !== null &&
    typeof raw.fields === "object" &&
    !Array.isArray(raw.fields)
      ? (raw.fields as Record<string, unknown>)
      : {};

  const flat: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(nestedFields)) {
    flat[key] = unwrapFieldValue(value);
  }

  for (const [key, value] of Object.entries(raw)) {
    if (key === "fields") continue;
    flat[key] = unwrapFieldValue(value);
  }

  const institution =
    raw.institution !== null &&
    typeof raw.institution === "object" &&
    !Array.isArray(raw.institution)
      ? (raw.institution as Record<string, unknown>)
      : null;

  if (!flat.loanName && institution) {
    flat.loanName =
      institution.rawName ??
      institution.normalizedName ??
      institution.name ??
      null;
  }

  return flat;
}

function normalizeDocumentType(value: unknown): string {
  if (typeof value !== "string") return "";

  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function looksLikeVehicleLoan(
  rawInput: Record<string, unknown>,
): boolean {
  const raw = flattenWrappedFields(rawInput);

  const type = normalizeDocumentType(
    raw.docType ??
      raw.documentType ??
      raw.type ??
      raw.accountType,
  );

  const autoLoanType =
    type === "auto loan" ||
    type === "vehicle loan" ||
    type === "car loan" ||
    type === "automobile loan" ||
    type.includes("auto loan") ||
    type.includes("vehicle loan") ||
    type.includes("car payment") ||
    type.includes("vehicle payment");

  if (autoLoanType) return true;

  const vehicleFieldKeys = [
    "balanceOwed",
    "remainingBalance",
    "originalAmount",
    "originalLoanAmount",
    "amountFinanced",
    "monthlyPayment",
    "regularMonthlyPayment",
    "loanTerm",
    "paymentsMade",
    "monthsRemaining",
    "accountNumber",
    "nextDueDate",
  ];

  const matchedFields = vehicleFieldKeys.filter(
    (key) =>
      raw[key] !== undefined &&
      raw[key] !== null &&
      raw[key] !== "",
  ).length;

  return matchedFields >= 3;
}

function normalizeVehicleLoanExtraction(rawInput: Record<string, unknown>) {
  const raw = flattenWrappedFields(rawInput);

  const originalTerm = parseInteger(
    firstDefined(raw.loanTerm, raw.termMonths, raw.originalTerm),
  );
  const paymentsMade = parseInteger(
    firstDefined(raw.paymentsMade, raw.numberOfPaymentsMade),
  );

  let monthsRemaining = parseInteger(
    firstDefined(
      raw.monthsRemaining, raw.remainingMonths, raw.remainingTerm,
      raw.paymentsRemaining, raw.monthsLeft,
    ),
  );

  if (monthsRemaining === null && originalTerm !== null && paymentsMade !== null) {
    monthsRemaining = Math.max(originalTerm - paymentsMade, 0);
  }
  if (monthsRemaining === null && originalTerm !== null) {
    monthsRemaining = originalTerm;
  }

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

    monthsRemaining,

    nextDueDate: firstDefined(
      raw.nextDueDate, raw.paymentDueDate, raw.nextPaymentDate, raw.dueDate,
    ) as string | null,

    confidence: (raw.confidence as Record<string, number>) ?? {},
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("vehicle-loan normalisation", () => {
  // ── Phase-11 acceptance document ─────────────────────────────────────────
  it("Phase-11: maps alternate labels to canonical keys", () => {
    const raw: Record<string, unknown> = {
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

  // ── All fields absent → all null ──────────────────────────────────────────
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
    assert.equal(getLast4("12"), "12");
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
    assert.equal(parseInteger(72.9), 73);
    assert.equal(parseInteger("48 months"), 48);
    assert.equal(parseInteger(null), null);
  });

  // ── Priority: canonical wins over fallback ────────────────────────────────
  it("canonical key takes priority over fallback aliases", () => {
    const raw: Record<string, unknown> = {
      balanceOwed: 5000,
      currentBalance: 9999,
      apr: 4.5,
      interestRate: 9.9,
    };
    const result = normalizeVehicleLoanExtraction(raw);
    assert.equal(result.balanceOwed, 5000);
    assert.equal(result.apr, 4.5);
  });

  // ─── New tests ────────────────────────────────────────────────────────────

  // 1. Flat Auto Loan output ─────────────────────────────────────────────────
  it("flat Auto Loan output: looksLikeVehicleLoan detects it and fields normalize", () => {
    const raw: Record<string, unknown> = {
      docType: "Auto Loan",
      loanName: "Pioneer Auto Finance",
      accountNumber: "xxxx4922",
      balanceOwed: 16843.72,
      originalAmount: 28750,
      apr: 7.24,
      monthlyPayment: 478.56,
      monthsRemaining: 44,
      nextDueDate: "2025-08-05",
    };

    assert.equal(looksLikeVehicleLoan(raw), true);

    const result = normalizeVehicleLoanExtraction(raw);
    assert.equal(result.loanName, "Pioneer Auto Finance");
    assert.equal(result.accountLast4, "4922");
    assert.equal(result.balanceOwed, 16843.72);
    assert.equal(result.originalAmount, 28750);
    assert.equal(result.apr, 7.24);
    assert.equal(result.monthlyPayment, 478.56);
    assert.equal(result.monthsRemaining, 44);
    assert.equal(result.nextDueDate, "2025-08-05");
  });

  // 2. Auto Loan values nested under fields (wrapped { value, confidence }) ──
  it("Auto Loan nested under fields: looksLikeVehicleLoan detects it and fields normalize", () => {
    const raw: Record<string, unknown> = {
      docType: "Auto Loan",
      fields: {
        loanName:       { value: "Pioneer Auto Finance", confidence: 95 },
        accountNumber:  { value: "xxxx4922",             confidence: 90 },
        balanceOwed:    { value: 16843.72,               confidence: 88 },
        originalAmount: { value: 28750,                  confidence: 92 },
        apr:            { value: 7.24,                   confidence: 91 },
        monthlyPayment: { value: 478.56,                 confidence: 89 },
        monthsRemaining:{ value: 44,                     confidence: 85 },
        nextDueDate:    { value: "2025-08-05",           confidence: 90 },
      },
    };

    assert.equal(looksLikeVehicleLoan(raw), true);

    const result = normalizeVehicleLoanExtraction(raw);
    assert.equal(result.loanName, "Pioneer Auto Finance");
    assert.equal(result.accountLast4, "4922");
    assert.equal(result.balanceOwed, 16843.72);
    assert.equal(result.originalAmount, 28750);
    assert.equal(result.apr, 7.24);
    assert.equal(result.monthlyPayment, 478.56);
    assert.equal(result.monthsRemaining, 44);
    assert.equal(result.nextDueDate, "2025-08-05");
  });

  // 3. docType "Vehicle Loan" ────────────────────────────────────────────────
  it('docType "Vehicle Loan" is detected as a vehicle loan', () => {
    const raw: Record<string, unknown> = {
      docType: "Vehicle Loan",
      balanceOwed: 22000,
      monthlyPayment: 399,
      nextDueDate: "2025-09-01",
    };

    assert.equal(looksLikeVehicleLoan(raw), true);
  });

  // 4. docType "Auto Loan Payment Statement" ────────────────────────────────
  it('docType "Auto Loan Payment Statement" is detected as a vehicle loan', () => {
    const raw: Record<string, unknown> = {
      docType: "Auto Loan Payment Statement",
      balanceOwed: 9800,
      monthlyPayment: 312,
      nextDueDate: "2025-10-01",
    };

    assert.equal(looksLikeVehicleLoan(raw), true);
  });

  // 5. Missing docType with three or more vehicle-loan fields ────────────────
  it("missing docType with 3+ vehicle-loan fields is detected as a vehicle loan", () => {
    const raw: Record<string, unknown> = {
      // No docType at all
      balanceOwed: 14500,
      originalAmount: 27000,
      monthlyPayment: 425.0,
    };

    assert.equal(looksLikeVehicleLoan(raw), true);
  });

  // 6. Normal utility bill must NOT be classified as an Auto Loan ─────────────
  it("utility bill is NOT detected as a vehicle loan", () => {
    const raw: Record<string, unknown> = {
      docType: "Utility Bill",
      providerName: "City Power & Water",
      accountNumber: "78901234",
      amountDue: 134.22,
      dueDate: "2025-08-15",
      billingPeriod: "July 2025",
    };

    assert.equal(looksLikeVehicleLoan(raw), false);
  });
});
