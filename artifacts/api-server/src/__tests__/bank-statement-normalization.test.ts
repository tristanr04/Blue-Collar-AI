/**
 * Unit tests for bank-statement extraction normalization.
 *
 * White-box tests of looksLikeBankStatement and normalizeBankStatementExtraction.
 * Functions are replicated here because they are not exported from scan.ts.
 * Keep in sync with any changes to those functions.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ─── Replicated helpers (keep in sync with scan.ts) ───────────────────────────

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

function getLast4(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/[^a-zA-Z0-9]/g, "").trim();
  return cleaned.length >= 4 ? cleaned.slice(-4) : cleaned || null;
}

function normalizeDate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const usMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (usMatch) {
    return `${usMatch[3]}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
  }
  return text;
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

function flattenWrappedFields(raw: Record<string, unknown>): Record<string, unknown> {
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
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function resolveInstitutionName(raw: Record<string, unknown>): string | null {
  const inst = raw.institution;
  if (typeof inst === "string" && inst) return inst;
  if (inst && typeof inst === "object" && !Array.isArray(inst)) {
    const o = inst as Record<string, unknown>;
    const name = o.rawName ?? o.normalizedName ?? o.name ?? o.value;
    if (typeof name === "string" && name) return name;
  }
  const fallback = firstDefined(
    raw.bankName, raw.bank, raw.financialInstitution,
    raw.institutionName, raw.lender, raw.issuer, raw.providerName,
  );
  return typeof fallback === "string" ? fallback : null;
}

function looksLikeBankStatement(rawInput: Record<string, unknown>): boolean {
  const raw = flattenWrappedFields(rawInput);

  const type = normalizeDocumentType(
    raw.docType ?? raw.documentType ?? raw.type ?? raw.accountType,
  );

  const nonBankType =
    type.includes("credit card") ||
    type.includes("loan") ||
    type.includes("mortgage") ||
    type.includes("heloc") ||
    type.includes("paystub") ||
    type.includes("pay stub") ||
    type.includes("brokerage") ||
    type.includes("ira") ||
    type.includes("401") ||
    type.includes("403") ||
    type.includes("457") ||
    type.includes("pension") ||
    type.includes("bill");

  if (nonBankType) return false;

  const bankDocTypes = [
    "bank statement",
    "checking statement",
    "checking account statement",
    "savings statement",
    "deposit account statement",
    "checking account",
    "savings account",
    "high-yield savings",
    "money market account",
    "certificate of deposit",
    "cash management account",
  ];

  if (bankDocTypes.some((t) => type === t || type.includes(t))) return true;

  const bankFieldKeys = [
    "closingBalance", "endingBalance", "openingBalance", "statementBalance",
    "currentBalance", "availableBalance", "balance",
    "statementStartDate", "statementEndDate", "statementStart", "statementEnd",
    "periodStart", "periodEnd", "apy", "annualPercentageYield",
  ];

  const matchedFields = bankFieldKeys.filter(
    (key) => raw[key] !== undefined && raw[key] !== null && raw[key] !== "",
  ).length;

  return matchedFields >= 3;
}

function normalizeBankStatementExtraction(rawInput: Record<string, unknown>) {
  const raw = flattenWrappedFields(rawInput);

  return {
    documentType: "bankStatement" as const,
    institution: resolveInstitutionName(raw),
    accountName: firstDefined(raw.accountName, raw.accountType, raw.accountTitle, raw.name) as string | null,
    lastFour: getLast4(firstDefined(raw.lastFour, raw.last4, raw.accountLast4, raw.lastFourDigits, raw.accountNumber)),
    closingBalance: parseMoney(firstDefined(
      raw.closingBalance, raw.endingBalance, raw.statementBalance,
      raw.balanceAsOf, raw.closingAccountBalance, raw.currentBalance, raw.balance,
    )),
    currentBalance: parseMoney(firstDefined(raw.currentBalance, raw.balance, raw.accountBalance)),
    availableBalance: parseMoney(firstDefined(raw.availableBalance, raw.availableFunds, raw.availableForWithdrawal)),
    statementStartDate: normalizeDate(firstDefined(
      raw.statementStartDate, raw.statementStart, raw.periodStart,
      raw.fromDate, raw.beginDate, raw.startDate, raw.statementPeriodStart,
    )),
    statementEndDate: normalizeDate(firstDefined(
      raw.statementEndDate, raw.statementEnd, raw.periodEnd,
      raw.throughDate, raw.endDate, raw.closingDate, raw.statementPeriodEnd,
    )),
    apy: parseApr(firstDefined(raw.apy, raw.annualPercentageYield)),
    confidence: (raw.confidence as Record<string, number>) ?? {},
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("bank-statement normalisation", () => {

  // 1. Chase Checking — wrapped { value, confidence } fields + institution envelope
  it("Chase Checking: wrapped fields + institution envelope normalize correctly", () => {
    const raw: Record<string, unknown> = {
      docType: "Checking Account",
      classificationConfidence: 94,
      institution: { rawName: "Chase Bank", isKnownInstitution: true },
      fields: {
        accountName:      { value: "Chase Total Checking", confidence: 92 },
        lastFour:         { value: "7890",                 confidence: 91 },
        currentBalance:   { value: 8234.56,                confidence: 95 },
        availableBalance: { value: 7900.00,                confidence: 88 },
        statementEndDate: { value: "2025-07-31",           confidence: 90 },
      },
    };

    assert.equal(looksLikeBankStatement(raw), true);

    const result = normalizeBankStatementExtraction(raw);
    assert.equal(result.documentType, "bankStatement");
    assert.equal(result.institution, "Chase Bank");
    assert.equal(result.accountName, "Chase Total Checking");
    assert.equal(result.lastFour, "7890");
    assert.equal(result.closingBalance, 8234.56);
    assert.equal(result.currentBalance, 8234.56);
    assert.equal(result.availableBalance, 7900.00);
    assert.equal(result.statementEndDate, "2025-07-31");
  });

  // 2. Bank of America — flat format with currency strings + statement dates
  it("Bank of America: flat format with currency strings normalizes correctly", () => {
    const raw: Record<string, unknown> = {
      docType: "Bank Statement",
      bankName: "Bank of America",
      accountName: "Advantage Plus Banking",
      accountNumber: "xxxx5678",
      closingBalance: "$15,420.30",
      availableBalance: "$15,200.00",
      statementStartDate: "07/01/2025",
      statementEndDate: "07/31/2025",
    };

    assert.equal(looksLikeBankStatement(raw), true);

    const result = normalizeBankStatementExtraction(raw);
    assert.equal(result.institution, "Bank of America");
    assert.equal(result.accountName, "Advantage Plus Banking");
    assert.equal(result.lastFour, "5678");
    assert.equal(result.closingBalance, 15420.30);
    assert.equal(result.availableBalance, 15200.00);
    assert.equal(result.statementStartDate, "2025-07-01");
    assert.equal(result.statementEndDate, "2025-07-31");
  });

  // 3. Wells Fargo — Savings Statement alias + APY + endingBalance alias
  it("Wells Fargo: Savings Statement alias, APY, endingBalance alias normalize correctly", () => {
    const raw: Record<string, unknown> = {
      docType: "Savings Statement",
      institution: "Wells Fargo Bank",
      accountName: "Way2Save Savings",
      lastFour: "3344",
      endingBalance: "$3,210.00",
      apy: "0.50%",
      statementStart: "2025-07-01",
      statementEnd: "2025-07-31",
    };

    assert.equal(looksLikeBankStatement(raw), true);

    const result = normalizeBankStatementExtraction(raw);
    assert.equal(result.institution, "Wells Fargo Bank");
    assert.equal(result.accountName, "Way2Save Savings");
    assert.equal(result.lastFour, "3344");
    assert.equal(result.closingBalance, 3210.00);
    assert.equal(result.apy, 0.50);
    assert.equal(result.statementStartDate, "2025-07-01");
    assert.equal(result.statementEndDate, "2025-07-31");
  });

  // 4. Local Credit Union — Deposit Account Statement alias + periodStart/periodEnd
  it("Local Credit Union: Deposit Account Statement alias normalizes correctly", () => {
    const raw: Record<string, unknown> = {
      docType: "Deposit Account Statement",
      institutionName: "Rivertown Credit Union",
      accountType: "Share Draft Checking",
      lastFour: "1234",
      closingBalance: 2100.00,
      availableBalance: 1975.50,
      periodStart: "2025-07-01",
      periodEnd: "2025-07-31",
    };

    assert.equal(looksLikeBankStatement(raw), true);

    const result = normalizeBankStatementExtraction(raw);
    assert.equal(result.institution, "Rivertown Credit Union");
    assert.equal(result.accountName, "Share Draft Checking");
    assert.equal(result.lastFour, "1234");
    assert.equal(result.closingBalance, 2100.00);
    assert.equal(result.availableBalance, 1975.50);
    assert.equal(result.statementStartDate, "2025-07-01");
    assert.equal(result.statementEndDate, "2025-07-31");
  });

  // 5. Generic Checking Statement — alias detection + balance/lastFour only
  it("Generic Checking Statement: alias detection and minimal fields normalize correctly", () => {
    const raw: Record<string, unknown> = {
      docType: "Checking Account Statement",
      bank: "First Community Bank",
      accountName: "Free Checking",
      lastFour: "4321",
      currentBalance: 985.42,
      availableBalance: 900.00,
    };

    assert.equal(looksLikeBankStatement(raw), true);

    const result = normalizeBankStatementExtraction(raw);
    assert.equal(result.institution, "First Community Bank");
    assert.equal(result.accountName, "Free Checking");
    assert.equal(result.lastFour, "4321");
    assert.equal(result.closingBalance, 985.42);
    assert.equal(result.currentBalance, 985.42);
    assert.equal(result.availableBalance, 900.00);
    assert.equal(result.statementStartDate, null);
    assert.equal(result.statementEndDate, null);
    assert.equal(result.apy, null);
  });

  // ─── Detection edge cases ─────────────────────────────────────────────────

  it('docType "Checking Account Statement" is detected as a bank statement', () => {
    assert.equal(looksLikeBankStatement({ docType: "Checking Account Statement" }), true);
  });

  it('docType "Savings Statement" is detected as a bank statement', () => {
    assert.equal(looksLikeBankStatement({ docType: "Savings Statement" }), true);
  });

  it('docType "Deposit Account Statement" is detected as a bank statement', () => {
    assert.equal(looksLikeBankStatement({ docType: "Deposit Account Statement" }), true);
  });

  it("missing docType with 3+ bank-specific fields is detected as a bank statement", () => {
    const raw: Record<string, unknown> = {
      closingBalance: 4400.00,
      statementStartDate: "2025-07-01",
      statementEndDate: "2025-07-31",
    };
    assert.equal(looksLikeBankStatement(raw), true);
  });

  it("2 bank fields is NOT enough for field-based detection", () => {
    const raw: Record<string, unknown> = {
      closingBalance: 4400.00,
      statementStartDate: "2025-07-01",
    };
    assert.equal(looksLikeBankStatement(raw), false);
  });

  it("Credit Card is NOT detected as a bank statement", () => {
    assert.equal(
      looksLikeBankStatement({ docType: "Credit Card", currentBalance: 1200, accountNumber: "xxxx1234" }),
      false,
    );
  });

  it("Auto Loan is NOT detected as a bank statement", () => {
    assert.equal(
      looksLikeBankStatement({ docType: "Auto Loan", balanceOwed: 14000, monthlyPayment: 350 }),
      false,
    );
  });

  it("Utility Bill is NOT detected as a bank statement", () => {
    assert.equal(
      looksLikeBankStatement({ docType: "Utility Bill", amountDue: 134, dueDate: "2025-08-15" }),
      false,
    );
  });

  it("missing fields stay null — never default to zero", () => {
    const result = normalizeBankStatementExtraction({});
    assert.equal(result.institution, null);
    assert.equal(result.accountName, null);
    assert.equal(result.lastFour, null);
    assert.equal(result.closingBalance, null);
    assert.equal(result.currentBalance, null);
    assert.equal(result.availableBalance, null);
    assert.equal(result.statementStartDate, null);
    assert.equal(result.statementEndDate, null);
    assert.equal(result.apy, null);
  });
});
