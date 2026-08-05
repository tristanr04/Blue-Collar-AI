/**
 * financialUpdater.ts
 *
 * Builds an UpdatePlan from confirmed ProcessedDoc objects, then applies it
 * to the store and records every change in the FinancialChangeRecord history.
 *
 * Key guarantees:
 *   - Never overwrites newer data without an explicit user choice
 *   - Never duplicates an existing account silently
 *   - Every applied change is recorded for undo / restore
 */

import type { Asset, Debt, Bill, FinancialChangeRecord } from './store';
import {
  findMatchingAsset,
  findMatchingDebt,
  findMatchingBill,
  assetBucket,
  isDebtType,
  isBillType,
} from './financialMatcher';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MatchChoice = 'update' | 'create' | 'skip';

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export type DestinationSection = 'assets' | 'debts' | 'bills' | 'paystubs';

export interface UpdatePlanEntry {
  /** ID of the ProcessedDoc this entry came from */
  docId: string;
  docType: string;
  /** human-readable label for the doc */
  docLabel: string;
  /** Which section the record goes into */
  destinationSection: DestinationSection;
  /** 'update' = matched existing record; 'create' = no match found */
  defaultAction: MatchChoice;
  /** The existing record's id, if matched */
  matchedId?: string;
  /** The existing record's display name, if matched */
  matchedName?: string;
  /** Per-field changes (old → new) when updating */
  changes: FieldChange[];
  /** Full payload to create/update the record */
  payload: Record<string, unknown>;
  /** True when the scanned statement date is older than existing data */
  isOlderStatement: boolean;
  /** Non-zero when a bill amount changed — used for callout display */
  billAmountDelta: number;
}

export interface UpdatePlan {
  entries: UpdatePlanEntry[];
  sourceDocumentId: string;
  sourceFilename: string;
  timestamp: string;
}

// ─── ProcessedDoc shape (mirrors Scanner.tsx) ─────────────────────────────────

interface ProcessedDocLike {
  id: string;
  file: File;
  docType: string;
  fields: Record<string, { value: string; confidence: number }>;
  institutionName: string;
  accepted: boolean;
  status: string;
}

// ─── Build plan ───────────────────────────────────────────────────────────────

export function buildUpdatePlan(
  docs: ProcessedDocLike[],
  store: { assets: Asset[]; debts: Debt[]; bills: Bill[] },
): UpdatePlan {
  const entries: UpdatePlanEntry[] = [];
  const acceptedDocs = docs.filter(d => d.accepted && d.status !== 'error');

  for (const doc of acceptedDocs) {
    const n = (key: string) => parseFloat(doc.fields[key]?.value ?? '') || 0;
    const s = (key: string) => doc.fields[key]?.value ?? '';
    const lastFour = s('lastFour');

    if (doc.docType === 'Paystub') {
      // Paystubs always create new records — never update existing
      const payload: Record<string, unknown> = {
        employer: s('employer') || 'Unknown',
        date: new Date().toISOString(),
        regularHours: n('regularHours'),
        overtimeHours: n('overtimeHours'),
        doubleTimeHours: n('doubleTimeHours'),
        perDiem: n('perDiem'),
        grossPay: n('grossPay'),
        taxes: n('federalTax') + n('stateTax') + n('socialSecurity') + n('medicare') || n('taxes'),
        deductions: n('unionDues') + n('insuranceDeductions') + n('otherDeductions'),
        netPay: n('netPay'),
      };
      entries.push({
        docId: doc.id,
        docType: doc.docType,
        docLabel: `Paystub – ${s('employer') || 'Unknown'}`,
        destinationSection: 'paystubs',
        defaultAction: 'create',
        changes: [],
        payload,
        isOlderStatement: false,
        billAmountDelta: 0,
      });
      continue;
    }

    if (isBillType(doc.docType)) {
      const provider = s('provider') || s('category') || doc.institutionName || doc.docType;
      const amountDue = n('amountDue');
      if (amountDue <= 0) continue;

      const dueDateRaw = parseInt(s('dueDate'), 10);
      const dueDate = Number.isNaN(dueDateRaw) ? 15 : Math.min(Math.max(dueDateRaw, 1), 31);
      const isAutoPay = s('autopay').toLowerCase().includes('yes') || s('autopay').toLowerCase().includes('true');

      const existingBill = findMatchingBill(store.bills, provider);
      const payload: Record<string, unknown> = { name: provider, amount: amountDue, dueDate, isAutoPay, providerNormalized: provider.toLowerCase().trim(), lastUpdatedAt: new Date().toISOString() };

      const changes: FieldChange[] = existingBill
        ? diffRecord(existingBill as unknown as Record<string, unknown>, payload, ['amount', 'dueDate', 'isAutoPay'])
        : [];

      entries.push({
        docId: doc.id,
        docType: doc.docType,
        docLabel: `Bill – ${provider}`,
        destinationSection: 'bills',
        defaultAction: existingBill ? 'update' : 'create',
        matchedId: existingBill?.id,
        matchedName: existingBill?.name,
        changes,
        payload,
        isOlderStatement: false,
        billAmountDelta: existingBill ? amountDue - existingBill.amount : 0,
      });
      continue;
    }

    const assetType = assetBucket(doc.docType);
    if (assetType) {
      // Banking / investment asset
      const bal =
        n('currentBalance') || n('closingBalance') || n('availableBalance') ||
        n('vestedBalance') || n('totalValue');
      if (bal <= 0) continue;

      const name = buildAssetName(doc);
      const statementDateStr = s('statementDate');
      const existingAsset = findMatchingAsset(
        store.assets,
        doc.docType,
        doc.institutionName,
        lastFour,
      );

      const isOlderStatement = existingAsset
        ? isOlderThan(statementDateStr, existingAsset.lastUpdatedAt)
        : false;

      const payload: Record<string, unknown> = {
        name,
        type: assetType,
        value: bal,
        institutionName: doc.institutionName || undefined,
        lastFour: lastFour || undefined,
        lastUpdatedAt: new Date().toISOString(),
      };

      const changes: FieldChange[] = existingAsset
        ? diffRecord(existingAsset as unknown as Record<string, unknown>, payload, ['value', 'name'])
        : [];

      entries.push({
        docId: doc.id,
        docType: doc.docType,
        docLabel: `${doc.docType} – ${doc.institutionName || name}`,
        destinationSection: 'assets',
        defaultAction: existingAsset ? 'update' : 'create',
        matchedId: existingAsset?.id,
        matchedName: existingAsset?.name,
        changes,
        payload,
        isOlderStatement,
        billAmountDelta: 0,
      });
      continue;
    }

    if (isDebtType(doc.docType)) {
      // Auto Loan uses canonical field names (balanceOwed, accountLast4, monthsRemaining);
      // other debt types fall back to the legacy names.
      const debtLastFour = s('accountLast4') || lastFour;
      const bal =
        n('balanceOwed') || n('currentBalance') || n('principalBalance') ||
        n('statementBalance') || n('closingBalance');
      if (bal <= 0) continue;

      const name = buildDebtName(doc);
      const statementDateStr = s('statementDate') || s('nextDueDate') || s('dueDate');
      const existingDebt = findMatchingDebt(
        store.debts,
        doc.docType,
        doc.institutionName || s('loanName') || s('issuer') || s('lender'),
        debtLastFour,
      );

      const isOlderStatement = existingDebt
        ? isOlderThan(statementDateStr, existingDebt.lastUpdatedAt)
        : false;

      const payload: Record<string, unknown> = {
        name,
        balance: bal,
        interestRate: n('apr') || n('interestRate'),
        minimumPayment: n('minimumPayment') || n('monthlyPayment'),
        institutionName: doc.institutionName || undefined,
        lastFour: debtLastFour || undefined,
        lastUpdatedAt: new Date().toISOString(),
      };

      const changes: FieldChange[] = existingDebt
        ? diffRecord(existingDebt as unknown as Record<string, unknown>, payload, ['balance', 'interestRate', 'minimumPayment'])
        : [];

      entries.push({
        docId: doc.id,
        docType: doc.docType,
        docLabel: `${doc.docType} – ${name}`,
        destinationSection: 'debts',
        defaultAction: existingDebt ? 'update' : 'create',
        matchedId: existingDebt?.id,
        matchedName: existingDebt?.name,
        changes,
        payload,
        isOlderStatement,
        billAmountDelta: 0,
      });
    }
  }

  return {
    entries,
    sourceDocumentId: acceptedDocs[0]?.id ?? crypto.randomUUID(),
    sourceFilename: acceptedDocs.map(d => d.file.name).join(', '),
    timestamp: new Date().toISOString(),
  };
}

// ─── Apply plan ───────────────────────────────────────────────────────────────

export interface ApplyPlanActions {
  addPaystub: (p: Omit<import('./store').Paystub, 'id'>) => string;
  updateAsset: (id: string, updates: Partial<Asset>) => void;
  addAsset: (a: Omit<Asset, 'id'>) => string;
  updateDebt: (id: string, updates: Partial<Debt>) => void;
  addDebt: (d: Omit<Debt, 'id'>) => string;
  updateBill: (id: string, updates: Partial<Bill>) => void;
  addBill: (b: Omit<Bill, 'id'>) => string;
}

/**
 * Apply the update plan using the provided store actions.
 * Returns an array of FinancialChangeRecord objects to persist.
 *
 * `choices` maps docId → 'update' | 'create' | 'skip'.
 * Entries without an explicit choice fall back to defaultAction.
 */
export function applyUpdatePlan(
  plan: UpdatePlan,
  choices: Record<string, MatchChoice>,
  actions: ApplyPlanActions,
): FinancialChangeRecord[] {
  const changeRecords: FinancialChangeRecord[] = [];
  const now = new Date().toISOString();

  for (const entry of plan.entries) {
    const action = choices[entry.docId] ?? entry.defaultAction;
    if (action === 'skip') continue;

    let recordId: string;

    if (entry.destinationSection === 'paystubs') {
      recordId = actions.addPaystub(entry.payload as any);
      // Use 'created' so undoImport can delete the paystub by recordId
      changeRecords.push(makeRecord({
        plan,
        entry,
        recordId,
        field: 'created',
        oldValue: null,
        newValue: entry.payload,
        now,
      }));
      continue;
    }

    if (action === 'update' && entry.matchedId) {
      recordId = entry.matchedId;

      // ONLY apply the exact fields that diffRecord tracks, so undo covers
      // everything that was actually written.
      // `lastUpdatedAt` is always written as metadata but is NOT recorded in
      // change history (no meaningful old value to restore to).
      if (entry.destinationSection === 'assets') {
        const p = entry.payload as Record<string, unknown>;
        const update: Partial<Asset> = { lastUpdatedAt: now };
        if (p.value !== undefined) update.value = p.value as number;
        if (p.name !== undefined) update.name = p.name as string;
        actions.updateAsset(recordId, update);
      } else if (entry.destinationSection === 'debts') {
        const p = entry.payload as Record<string, unknown>;
        const update: Partial<Debt> = { lastUpdatedAt: now };
        if (p.balance !== undefined) update.balance = p.balance as number;
        if (p.interestRate !== undefined) update.interestRate = p.interestRate as number;
        if (p.minimumPayment !== undefined) update.minimumPayment = p.minimumPayment as number;
        actions.updateDebt(recordId, update);
      } else if (entry.destinationSection === 'bills') {
        const p = entry.payload as Record<string, unknown>;
        const update: Partial<Bill> = { lastUpdatedAt: now };
        if (p.amount !== undefined) update.amount = p.amount as number;
        if (p.dueDate !== undefined) update.dueDate = p.dueDate as number;
        if (p.isAutoPay !== undefined) update.isAutoPay = p.isAutoPay as boolean;
        actions.updateBill(recordId, update);
      }

      // Record only the tracked field changes that have a previous value to restore
      for (const change of entry.changes) {
        if (change.oldValue === null || change.oldValue === undefined) continue;
        changeRecords.push(makeRecord({
          plan, entry, recordId,
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
          now,
        }));
      }
      // No fallback record for no-diff updates — a no-op needs no history entry
    } else {
      // Create new record
      if (entry.destinationSection === 'assets') {
        recordId = actions.addAsset(entry.payload as Omit<Asset, 'id'>);
      } else if (entry.destinationSection === 'debts') {
        recordId = actions.addDebt(entry.payload as Omit<Debt, 'id'>);
      } else if (entry.destinationSection === 'bills') {
        recordId = actions.addBill(entry.payload as Omit<Bill, 'id'>);
      } else {
        continue;
      }
      changeRecords.push(makeRecord({
        plan,
        entry,
        recordId,
        field: 'created',
        oldValue: null,
        newValue: entry.payload,
        now,
      }));
    }
  }

  return changeRecords;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRecord({
  plan,
  entry,
  recordId,
  field,
  oldValue,
  newValue,
  now,
}: {
  plan: UpdatePlan;
  entry: UpdatePlanEntry;
  recordId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  now: string;
}): FinancialChangeRecord {
  return {
    id: crypto.randomUUID(),
    timestamp: now,
    sourceDocumentId: plan.sourceDocumentId,
    sourceFilename: plan.sourceFilename,
    destinationSection: entry.destinationSection,
    recordId,
    field,
    oldValue,
    newValue,
    userConfirmed: true,
  };
}

function diffRecord(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  fields: string[],
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of fields) {
    const oldVal = existing[field];
    const newVal = incoming[field];
    if (oldVal !== newVal && newVal !== undefined) {
      changes.push({ field, oldValue: oldVal, newValue: newVal });
    }
  }
  return changes;
}

function isOlderThan(
  statementDateStr: string | undefined,
  existingDateStr: string | undefined,
): boolean {
  if (!statementDateStr || !existingDateStr) return false;
  try {
    const statDate = new Date(statementDateStr).getTime();
    const existDate = new Date(existingDateStr).getTime();
    if (Number.isNaN(statDate) || Number.isNaN(existDate)) return false;
    return statDate < existDate;
  } catch {
    return false;
  }
}

function buildAssetName(doc: ProcessedDocLike): string {
  const s = (key: string) => doc.fields[key]?.value ?? '';
  // For retirement plans, combine plan name + provider
  const isRetirement = [
    '401(k)', 'Roth 401(k)', '403(b)', '457(b)', 'Thrift Savings Plan',
    'Pension', 'Traditional IRA', 'Roth IRA', 'SEP IRA', 'SIMPLE IRA',
    'Rollover IRA', 'HSA Investment Account', 'Retirement Account', 'Retirement Statement',
  ].includes(doc.docType);

  if (isRetirement) {
    const planLabel = s('planName') || doc.docType;
    const provider = doc.institutionName || s('institution') || s('employer');
    return provider ? `${planLabel} – ${provider}` : planLabel;
  }

  return s('accountName') || doc.institutionName || s('institution') || doc.docType;
}

function buildDebtName(doc: ProcessedDocLike): string {
  const s = (key: string) => doc.fields[key]?.value ?? '';
  if (doc.docType === 'Mortgage' || doc.docType === 'HELOC') {
    const lender = doc.institutionName || s('lender');
    return lender ? `${doc.docType} – ${lender}` : doc.docType;
  }
  return s('loanName') || s('servicer') || s('lender') || s('accountName') || s('issuer') || doc.institutionName || doc.docType;
}
