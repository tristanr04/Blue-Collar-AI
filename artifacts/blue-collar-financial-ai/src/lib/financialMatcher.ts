/**
 * financialMatcher.ts
 *
 * Pure, side-effect-free functions for matching a scanned document against
 * existing records in the store. Used by financialUpdater to decide whether
 * to "Update existing" or "Create new" for each confirmed document.
 *
 * Matching strategy (ordered by priority):
 *   1. Last-four digit match (most reliable for bank/credit accounts)
 *   2. Institution name fuzzy-match within the correct type bucket
 *   3. No match → create new
 */

import type { Asset, Debt, Bill } from './store';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Lowercase, strip non-alphanumeric. Used for all string comparisons. */
function norm(s: string | undefined | null): string {
  if (!s) return '';
  return s.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

/** True if a and b share a common token of ≥4 chars or one contains the other. */
function fuzzyMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  // Token overlap: share at least one word ≥4 chars
  const ta = na.match(/[a-z0-9]{4,}/g) ?? [];
  const tb = new Set(nb.match(/[a-z0-9]{4,}/g) ?? []);
  return ta.some(t => tb.has(t));
}

/** Document type → asset type bucket */
function assetBucket(docType: string): 'Cash' | 'Investment' | null {
  const cash = [
    'Checking Account', 'Savings Account', 'High-Yield Savings',
    'Money Market Account', 'Certificate of Deposit', 'Cash Management Account',
    'Bank Statement',
  ];
  const investment = [
    'Brokerage Account', 'Margin Account', 'Robo-Adviser Account',
    'Employee Stock Plan', 'Investment Statement',
    '401(k)', 'Roth 401(k)', '403(b)', '457(b)',
    'Traditional IRA', 'Roth IRA', 'SEP IRA', 'SIMPLE IRA', 'Rollover IRA',
    'Pension', 'Thrift Savings Plan', 'HSA Investment Account',
    'Retirement Account', 'Retirement Statement',
  ];
  if (cash.includes(docType)) return 'Cash';
  if (investment.includes(docType)) return 'Investment';
  return null;
}

/** Document types that map to debts */
function isDebtType(docType: string): boolean {
  return [
    'Credit Card', 'Credit Card Statement', 'Line of Credit',
    'Auto Loan', 'Personal Loan', 'Student Loan',
    'Mortgage', 'HELOC',
  ].includes(docType);
}

/** Document types that map to bills */
function isBillType(docType: string): boolean {
  return ['Monthly Bill', 'Utility Bill'].includes(docType);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Find an existing Asset that probably represents the same account as the
 * scanned document. Returns null if no confident match.
 */
export function findMatchingAsset(
  assets: Asset[],
  docType: string,
  institutionName: string,
  lastFour: string,
): Asset | null {
  const bucket = assetBucket(docType);
  if (!bucket) return null;

  const candidates = assets.filter(a => a.type === bucket);
  if (candidates.length === 0) return null;

  // 1 — Last-four exact match (highest confidence for bank accounts)
  if (lastFour && lastFour.length === 4) {
    const hit = candidates.find(
      a =>
        a.lastFour === lastFour ||
        // also check the account name ends with the digits (e.g. "Chase …4428")
        norm(a.name).endsWith(lastFour),
    );
    if (hit) return hit;
  }

  // 2 — Institution name fuzzy match
  if (institutionName) {
    const hit = candidates.find(
      a =>
        fuzzyMatch(a.name, institutionName) ||
        fuzzyMatch(a.institutionName ?? '', institutionName),
    );
    if (hit) return hit;
  }

  return null;
}

/**
 * Find an existing Debt that probably represents the same loan / card as the
 * scanned document. Returns null if no confident match.
 */
export function findMatchingDebt(
  debts: Debt[],
  docType: string,
  institutionName: string,
  lastFour: string,
): Debt | null {
  if (!isDebtType(docType)) return null;
  if (debts.length === 0) return null;

  // 1 — Last-four match
  if (lastFour && lastFour.length === 4) {
    const hit = debts.find(
      d =>
        d.lastFour === lastFour ||
        norm(d.name).endsWith(lastFour),
    );
    if (hit) return hit;
  }

  // 2 — Institution / lender name match
  if (institutionName) {
    const hit = debts.find(
      d =>
        fuzzyMatch(d.name, institutionName) ||
        fuzzyMatch(d.institutionName ?? '', institutionName),
    );
    if (hit) return hit;
  }

  return null;
}

/**
 * Find an existing Bill whose provider matches the scanned document.
 * Bills have no account number, so we rely on name similarity only.
 */
export function findMatchingBill(bills: Bill[], provider: string): Bill | null {
  if (!provider || bills.length === 0) return null;
  return bills.find(b => fuzzyMatch(b.name, provider) || fuzzyMatch(b.providerNormalized ?? '', provider)) ?? null;
}

/**
 * Compute a string idempotency key for a File to prevent the same document
 * from queuing twice.
 */
export function fileIdempotencyKey(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

/** Exposed for re-use in other modules. */
export { fuzzyMatch, assetBucket, isDebtType, isBillType };
