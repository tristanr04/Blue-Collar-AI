/**
 * Shared helper: convert a getFinancialSnapshot() result to a HealthScoreInput.
 * Used by both the /health-score and /weekly-snapshot routes.
 */

import type { HealthScoreInput } from "./health-score-engine.js";
import { getFinancialSnapshot } from "./financial-repository.js";

type Snapshot = Awaited<ReturnType<typeof getFinancialSnapshot>>;
type Row = Record<string, unknown>;

function text(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function finite(...values: unknown[]): number | null {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

function monthlyMultiplier(payFrequency: string): number {
  const n = payFrequency.toLowerCase().replace(/[^a-z]/g, "");
  if (n === "weekly") return 52 / 12;
  if (n === "biweekly" || n === "everytwoweeks") return 26 / 12;
  if (n === "semimonthly" || n === "twiceamonth") return 2;
  if (n === "monthly") return 1;
  return 0;
}

function r(v: unknown): Row {
  return v && typeof v === "object" ? (v as Row) : {};
}

function isRetirement(name: string, type: string): boolean {
  return /401|403|457|ira|retirement|pension/.test(`${type} ${name}`.toLowerCase());
}
function isInvestment(name: string, type: string): boolean {
  return /investment|brokerage|stock|401|403|457|ira|retirement|pension/.test(`${type} ${name}`.toLowerCase());
}
function isCash(name: string, type: string): boolean {
  return /cash|checking|savings|money.market|hysa/.test(`${type} ${name}`.toLowerCase());
}
function isInsuranceRelated(name: string): boolean {
  return /insurance|policy|coverage|life |health |auto |home |renters /i.test(name);
}

export function buildHealthScoreInputFromSnapshot(snapshot: Snapshot): HealthScoreInput {
  const profile = r(snapshot.profile);
  const paystubs = snapshot.paystubs.map(r);
  const debts = snapshot.debts.map(r);
  const bills = snapshot.bills.map(r);
  const assets = snapshot.assets.map(r);

  const multiplier = monthlyMultiplier(text(profile.payFrequency, profile.paySchedule));
  const latestNetPay = paystubs[0] ? finite(paystubs[0].netPay, paystubs[0].takeHomePay) : null;
  const monthlyNetIncome = latestNetPay !== null && multiplier > 0
    ? latestNetPay * multiplier
    : finite(profile.monthlyNetIncome, profile.monthlyTakeHome);

  const cash = sumKnown(assets.filter((a) => isCash(text(a.name), text(a.type))).map((a) => finite(a.value, a.balance)));
  const retirement = sumKnown(assets.filter((a) => isRetirement(text(a.name), text(a.type))).map((a) => finite(a.value, a.balance)));
  const investments = sumKnown(
    assets.filter((a) => isInvestment(text(a.name), text(a.type)) && !isRetirement(text(a.name), text(a.type)))
      .map((a) => finite(a.value, a.balance)),
  );
  const totalDebt = sumKnown(debts.map((d) => finite(d.balance, d.currentBalance, d.amountOwed)));
  const highInterestDebt = sumKnown(
    debts.filter((d) => (finite(d.apr, d.interestRate) ?? 0) >= 10).map((d) => finite(d.balance, d.currentBalance)),
  );

  const revolvingDebts = debts.filter((d) => /credit|card|revolving/.test(`${text(d.type)} ${text(d.name)}`.toLowerCase()));
  const revolvingBalance = sumKnown(revolvingDebts.map((d) => finite(d.balance)));
  const revolvingLimits = sumKnown(revolvingDebts.map((d) => finite(d.creditLimit, d.limit)));
  const creditUtilization = revolvingBalance !== null && revolvingLimits !== null && revolvingLimits > 0
    ? (revolvingBalance / revolvingLimits) * 100
    : null;

  const monthlyBills = sumKnown(bills.map((b) => finite(b.amount, b.monthlyAmount, b.payment)));
  const monthlyDebtPayments = sumKnown(debts.map((d) => finite(d.minimumPayment, d.monthlyPayment, d.payment)));

  const hasInsurance = bills.some((b) => isInsuranceRelated(text(b.name, b.providerNormalized))) ||
    assets.some((a) => isInsuranceRelated(text(a.name, a.type)));

  let filled = 0;
  if (monthlyNetIncome !== null) filled++;
  if (monthlyBills !== null) filled++;
  if (totalDebt !== null) filled++;
  if (cash !== null) filled++;
  if (investments !== null || retirement !== null) filled++;
  const documentCompletionPct = (filled / 5) * 100;

  return {
    monthlyNetIncome,
    paystubCount: paystubs.length,
    monthlyBills,
    monthlyDebtPayments,
    cash,
    investments,
    retirement,
    totalDebt,
    highInterestDebt,
    creditUtilization,
    hasTaxEstimate: false,
    taxEstimateAgeDays: null,
    hasInsurance,
    documentCompletionPct,
  };
}
