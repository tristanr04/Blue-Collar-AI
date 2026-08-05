/**
 * Pure constructors for timeline event inputs.
 * Each function produces a fully-formed TimelineEventInput ready to pass
 * to appendTimelineEvent(). No DB calls here — just data transformation.
 */

import type { TimelineEventInput } from "./timeline-repository.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fmt(value: number): string {
  return `$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

// ─── Paystub ─────────────────────────────────────────────────────────────────

export function makePaystubEvent(
  userId: string,
  record: { id: string; payDate: Date | null; netPay: number | null },
  previousNetPay: number | null,
  isUpdate: boolean,
): TimelineEventInput {
  const eventDate = record.payDate ?? new Date();
  const newValue = record.netPay;
  const prevValue = previousNetPay;
  const changeAmount =
    newValue !== null && prevValue !== null ? newValue - prevValue : null;
  const eventType = isUpdate ? "paystub_updated" : "paystub_added";

  let title = isUpdate ? "Paystub updated" : "Paystub added";
  let description =
    newValue !== null
      ? `Take-home pay of ${fmt(newValue)} recorded.`
      : "A paystub record was saved.";

  if (changeAmount !== null && changeAmount !== 0) {
    title =
      changeAmount > 0 ? "Take-home pay increased" : "Take-home pay decreased";
    description = `Net pay ${changeAmount > 0 ? "increased" : "decreased"} by ${fmt(changeAmount)}.`;
  }

  return {
    userId,
    eventType,
    eventDate,
    sourceRecordType: "paystub",
    sourceRecordId: record.id,
    previousValue: prevValue,
    newValue,
    changeAmount,
    title,
    description,
    idempotencyKey: `${eventType}:${record.id}:${isoDay(eventDate)}`,
  };
}

// ─── Asset ───────────────────────────────────────────────────────────────────

export function makeAssetEvent(
  userId: string,
  record: {
    id: string;
    name: string;
    type: string;
    value: number | null;
    updatedAt: Date | null;
  },
  previousValue: number | null,
  isUpdate: boolean,
): TimelineEventInput {
  const newValue = record.value;
  const prevValue = previousValue;
  const changeAmount =
    newValue !== null && prevValue !== null ? newValue - prevValue : null;
  const eventDate = record.updatedAt ?? new Date();
  const descriptor = `${record.type} ${record.name}`.toLowerCase();

  let eventType: TimelineEventInput["eventType"] = "bank_balance_updated";
  if (/retirement|401|403|457|ira|pension/.test(descriptor)) {
    eventType = "retirement_balance_updated";
  } else if (/investment|brokerage|stock/.test(descriptor)) {
    eventType = "investment_balance_updated";
  }

  const category =
    eventType === "retirement_balance_updated"
      ? "Retirement"
      : eventType === "investment_balance_updated"
        ? "Investment"
        : "Bank";

  let title = isUpdate ? `${category} balance updated` : `${record.name} added`;
  let description =
    newValue !== null ? `Balance of ${fmt(newValue)} recorded.` : `${record.name} was saved.`;

  if (isUpdate && changeAmount !== null && changeAmount !== 0) {
    title = `${category} balance ${changeAmount > 0 ? "increased" : "decreased"}`;
    description = `${record.name} balance ${changeAmount > 0 ? "increased" : "decreased"} by ${fmt(changeAmount)}.`;
  }

  return {
    userId,
    eventType,
    eventDate,
    sourceRecordType: "asset",
    sourceRecordId: record.id,
    previousValue: prevValue,
    newValue,
    changeAmount,
    title,
    description,
    idempotencyKey: `${eventType}:${record.id}:${isoDay(eventDate)}`,
  };
}

// ─── Debt ────────────────────────────────────────────────────────────────────

export function makeDebtEvent(
  userId: string,
  record: {
    id: string;
    name: string;
    balance: number | null;
    isRevolving: boolean | null;
    updatedAt: Date | null;
  },
  previousBalance: number | null,
  isUpdate: boolean,
): TimelineEventInput {
  const newValue = record.balance;
  const prevValue = previousBalance;
  const changeAmount =
    newValue !== null && prevValue !== null ? newValue - prevValue : null;
  const eventDate = record.updatedAt ?? new Date();
  const eventType = record.isRevolving
    ? "credit_card_balance_updated"
    : "loan_balance_updated";
  const label = record.isRevolving ? "Credit-card" : "Loan";

  let title = isUpdate ? `${label} balance updated` : `${record.name} added`;
  let description =
    newValue !== null ? `Balance of ${fmt(newValue)} recorded.` : `${record.name} was saved.`;

  if (isUpdate && changeAmount !== null && changeAmount !== 0) {
    title =
      changeAmount < 0 ? `${label} debt dropped` : `${label} balance increased`;
    description = `${record.name} balance ${changeAmount < 0 ? "decreased" : "increased"} by ${fmt(changeAmount)}.`;
  }

  return {
    userId,
    eventType,
    eventDate,
    sourceRecordType: "debt",
    sourceRecordId: record.id,
    previousValue: prevValue,
    newValue,
    changeAmount,
    title,
    description,
    idempotencyKey: `${eventType}:${record.id}:${isoDay(eventDate)}`,
  };
}

// ─── Bill ────────────────────────────────────────────────────────────────────

export function makeBillEvent(
  userId: string,
  record: {
    id: string;
    name: string;
    amount: number | null;
    updatedAt: Date | null;
  },
  previousAmount: number | null,
  isUpdate: boolean,
): TimelineEventInput {
  const newValue = record.amount;
  const prevValue = previousAmount;
  const changeAmount =
    newValue !== null && prevValue !== null ? newValue - prevValue : null;
  const eventDate = record.updatedAt ?? new Date();
  const eventType = isUpdate ? "bill_changed" : "bill_added";

  let title = isUpdate ? `${record.name} updated` : `${record.name} added`;
  let description =
    newValue !== null
      ? `Monthly bill of ${fmt(newValue)} recorded.`
      : `${record.name} was saved.`;

  if (isUpdate && changeAmount !== null && changeAmount !== 0) {
    title = `${record.name} changed`;
    description = `Monthly amount ${changeAmount > 0 ? "increased" : "decreased"} by ${fmt(changeAmount)}.`;
  }

  return {
    userId,
    eventType,
    eventDate,
    sourceRecordType: "bill",
    sourceRecordId: record.id,
    previousValue: prevValue,
    newValue,
    changeAmount,
    title,
    description,
    idempotencyKey: `${eventType}:${record.id}:${isoDay(eventDate)}`,
  };
}

// ─── Tax estimate ─────────────────────────────────────────────────────────────

export function makeTaxEstimateEvent(
  userId: string,
  record: {
    id: string;
    updatedAt: Date | null;
    result: Record<string, unknown>;
  },
  previousRefund: number | null,
): TimelineEventInput {
  const result = record.result ?? {};
  const refundOrOwed =
    typeof result.refundOrAmountOwed === "number"
      ? (result.refundOrAmountOwed as number)
      : null;
  const prevValue = previousRefund;
  const changeAmount =
    refundOrOwed !== null && prevValue !== null ? refundOrOwed - prevValue : null;
  const eventDate = record.updatedAt ?? new Date();

  let title = "Tax estimate saved";
  let description =
    refundOrOwed !== null
      ? refundOrOwed >= 0
        ? `Estimated refund of ${fmt(refundOrOwed)}.`
        : `Estimated tax owed of ${fmt(Math.abs(refundOrOwed))}.`
      : "A tax estimate was saved.";

  if (changeAmount !== null && changeAmount !== 0) {
    title =
      changeAmount > 0
        ? "Estimated refund increased"
        : "Estimated refund decreased";
    description = `Your estimated refund ${changeAmount > 0 ? "increased" : "decreased"} by ${fmt(Math.abs(changeAmount))}.`;
  }

  return {
    userId,
    eventType: "tax_estimate_saved",
    eventDate,
    sourceRecordType: "tax_scenario",
    sourceRecordId: record.id,
    previousValue: prevValue,
    newValue: refundOrOwed,
    changeAmount,
    title,
    description,
    idempotencyKey: `tax_estimate_saved:${record.id}:${isoDay(eventDate)}`,
  };
}
