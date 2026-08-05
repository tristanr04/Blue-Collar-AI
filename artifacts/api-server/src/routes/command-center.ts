import { Router, type IRouter } from "express";
import type { AuthenticatedRequest } from "../middlewares/auth.js";
import { requireAuthenticatedUser } from "../middlewares/auth.js";
import { ensureUser, getFinancialSnapshot } from "../lib/financial-repository.js";
import { createCommandCenterSummary, type CommandCenterInput } from "../lib/command-center-summary.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.use("/command-center", requireAuthenticatedUser);

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function finite(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

function text(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function monthlyMultiplier(payFrequency: string): number {
  const normalized = payFrequency.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized === "weekly") return 52 / 12;
  if (normalized === "biweekly" || normalized === "everytwoweeks") return 26 / 12;
  if (normalized === "semimonthly" || normalized === "twiceamonth") return 2;
  if (normalized === "monthly") return 1;
  return 0;
}

function isInvestment(asset: UnknownRecord): boolean {
  const descriptor = `${text(asset.type)} ${text(asset.name)} ${text(asset.category)}`.toLowerCase();
  return /investment|brokerage|stock|401|403|457|ira|retirement|pension/.test(descriptor);
}

function isRetirement(asset: UnknownRecord): boolean {
  const descriptor = `${text(asset.type)} ${text(asset.name)} ${text(asset.category)}`.toLowerCase();
  return /401|403|457|ira|retirement|pension/.test(descriptor);
}

function isCash(asset: UnknownRecord): boolean {
  const descriptor = `${text(asset.type)} ${text(asset.name)} ${text(asset.category)}`.toLowerCase();
  return /cash|checking|savings|money market|hysa/.test(descriptor);
}

function assetValue(asset: UnknownRecord): number | null {
  return finite(asset.value, asset.balance, asset.currentBalance, asset.amount);
}

function debtBalance(debt: UnknownRecord): number | null {
  return finite(debt.balance, debt.currentBalance, debt.amountOwed, debt.principal);
}

function debtPayment(debt: UnknownRecord): number | null {
  return finite(debt.minimumPayment, debt.monthlyPayment, debt.payment);
}

function billAmount(bill: UnknownRecord): number | null {
  return finite(bill.amount, bill.monthlyAmount, bill.payment);
}

function paystubNet(paystub: UnknownRecord): number | null {
  return finite(paystub.netPay, paystub.takeHomePay, paystub.netAmount);
}

function toSummaryInput(snapshot: Awaited<ReturnType<typeof getFinancialSnapshot>>): CommandCenterInput {
  const profile = record(snapshot.profile);
  const paystubs = snapshot.paystubs.map(record);
  const debts = snapshot.debts.map(record);
  const bills = snapshot.bills.map(record);
  const assets = snapshot.assets.map(record);

  const latestPaystub = paystubs[0];
  const multiplier = monthlyMultiplier(text(profile.payFrequency, profile.paySchedule));
  const latestNetPay = latestPaystub ? paystubNet(latestPaystub) : null;
  const monthlyNetIncome = latestNetPay !== null && multiplier > 0
    ? latestNetPay * multiplier
    : finite(profile.monthlyNetIncome, profile.monthlyTakeHome);

  const billValues = bills.map(billAmount);
  const debtPayments = debts.map(debtPayment);
  const debtBalances = debts.map(debtBalance);

  const cash = sumKnown(assets.filter(isCash).map(assetValue));
  const retirement = sumKnown(assets.filter(isRetirement).map(assetValue));
  const investments = sumKnown(assets.filter(asset => isInvestment(asset) && !isRetirement(asset)).map(assetValue));
  const otherAssets = sumKnown(assets.filter(asset => !isCash(asset) && !isInvestment(asset)).map(assetValue));

  const highInterestDebt = sumKnown(
    debts
      .filter(debt => (finite(debt.apr, debt.interestRate) ?? 0) >= 10)
      .map(debtBalance),
  );

  const revolvingDebts = debts.filter(debt => /credit|card|revolving/.test(`${text(debt.type)} ${text(debt.name)}`.toLowerCase()));
  const revolvingBalance = sumKnown(revolvingDebts.map(debtBalance));
  const revolvingLimits = sumKnown(revolvingDebts.map(debt => finite(debt.creditLimit, debt.limit)));
  const creditUtilization = revolvingBalance !== null && revolvingLimits !== null && revolvingLimits > 0
    ? (revolvingBalance / revolvingLimits) * 100
    : finite(profile.creditUtilization);

  return {
    monthlyNetIncome,
    monthlyBills: sumKnown(billValues),
    monthlyDebtPayments: sumKnown(debtPayments),
    cash,
    investments,
    retirement,
    otherAssets,
    totalDebt: sumKnown(debtBalances),
    highInterestDebt,
    creditUtilization,
    employerMatchCaptured: typeof profile.employerMatchCaptured === "boolean" ? profile.employerMatchCaptured : null,
    latestTaxEstimate: null,
  };
}

router.get("/command-center/summary", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    await ensureUser({ userId });
    const snapshot = await getFinancialSnapshot(userId);
    const summary = createCommandCenterSummary(toSummaryInput(snapshot));

    res.json({
      generatedAt: new Date().toISOString(),
      ...summary,
    });
  } catch (error) {
    logger.error({ err: error }, "command center summary failed");
    res.status(500).json({
      stage: "command_center",
      error: "Your financial summary could not be loaded right now.",
    });
  }
});

export default router;
