/**
 * Pure display-logic helpers for the Financial Timeline page.
 * No DOM dependencies — fully unit-testable.
 */

import type { TimelineEvent, MonthlyTrends } from './api';

// ─── Money formatting ──────────────────────────────────────────────────────────

export function formatMoney(value: number): string {
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return value < 0 ? `-$${formatted}` : `$${formatted}`;
}

export function formatMoneyAbs(value: number): string {
  return `$${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

// ─── Change display ────────────────────────────────────────────────────────────

export type ChangeDisplay =
  | { kind: 'increase'; label: string; amount: number }
  | { kind: 'decrease'; label: string; amount: number }
  | { kind: 'none' };

/** Resolve a changeAmount to a typed display object. */
export function resolveChange(changeAmount: number | null | undefined): ChangeDisplay {
  if (changeAmount === null || changeAmount === undefined || changeAmount === 0) {
    return { kind: 'none' };
  }
  if (changeAmount > 0) {
    return { kind: 'increase', label: `+${formatMoney(changeAmount)}`, amount: changeAmount };
  }
  return { kind: 'decrease', label: formatMoney(changeAmount), amount: changeAmount };
}

// ─── Trend display ────────────────────────────────────────────────────────────

export type TrendDisplay =
  | { kind: 'positive'; label: string; amount: number }
  | { kind: 'negative'; label: string; amount: number }
  | { kind: 'neutral'; label: string; amount: number }
  | { kind: 'empty'; prompt: string };

/**
 * Resolve a monthly trend value to a typed display.
 * Null = no data this month → shows an empty state prompt.
 * Never returns a fake $0 for null input.
 */
export function resolveTrend(
  value: number | null | undefined,
  emptyPrompt: string,
  /** When true, a negative value (debt going up) is shown as negative/bad */
  negativeIsBad = true,
): TrendDisplay {
  if (value === null || value === undefined) {
    return { kind: 'empty', prompt: emptyPrompt };
  }
  if (value === 0) {
    return { kind: 'neutral', label: '$0 change', amount: 0 };
  }
  const label = value > 0 ? `+${formatMoney(value)}` : formatMoney(value);
  if (value > 0) {
    return { kind: 'positive', label, amount: value };
  }
  return { kind: negativeIsBad ? 'negative' : 'positive', label, amount: value };
}

// ─── Event category metadata ───────────────────────────────────────────────────

export type EventCategory = {
  label: string;
  colorClass: string;   // Tailwind text colour
  bgClass: string;      // Tailwind bg + border colour
};

const CATEGORY_MAP: Record<string, EventCategory> = {
  paystub_added:                { label: 'Income',      colorClass: 'text-emerald-300', bgClass: 'border-emerald-500/20 bg-emerald-500/10' },
  paystub_updated:              { label: 'Income',      colorClass: 'text-emerald-300', bgClass: 'border-emerald-500/20 bg-emerald-500/10' },
  bank_balance_updated:         { label: 'Cash',        colorClass: 'text-blue-300',    bgClass: 'border-blue-500/20 bg-blue-500/10' },
  investment_balance_updated:   { label: 'Investments', colorClass: 'text-violet-300',  bgClass: 'border-violet-500/20 bg-violet-500/10' },
  retirement_balance_updated:   { label: 'Retirement',  colorClass: 'text-violet-300',  bgClass: 'border-violet-500/20 bg-violet-500/10' },
  credit_card_balance_updated:  { label: 'Credit card', colorClass: 'text-rose-300',    bgClass: 'border-rose-500/20 bg-rose-500/10' },
  loan_balance_updated:         { label: 'Loan',        colorClass: 'text-rose-300',    bgClass: 'border-rose-500/20 bg-rose-500/10' },
  bill_added:                   { label: 'Bills',       colorClass: 'text-amber-300',   bgClass: 'border-amber-500/20 bg-amber-500/10' },
  bill_changed:                 { label: 'Bills',       colorClass: 'text-amber-300',   bgClass: 'border-amber-500/20 bg-amber-500/10' },
  tax_estimate_saved:           { label: 'Taxes',       colorClass: 'text-cyan-300',    bgClass: 'border-cyan-500/20 bg-cyan-500/10' },
  health_score_changed:         { label: 'Health score', colorClass: 'text-emerald-300', bgClass: 'border-emerald-500/20 bg-emerald-500/10' },
};

const DEFAULT_CATEGORY: EventCategory = {
  label: 'Update',
  colorClass: 'text-slate-300',
  bgClass: 'border-slate-500/20 bg-slate-500/10',
};

export function getEventCategory(eventType: string): EventCategory {
  return CATEGORY_MAP[eventType] ?? DEFAULT_CATEGORY;
}

// ─── Date formatting ───────────────────────────────────────────────────────────

export function formatEventDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Monthly trend sentence ───────────────────────────────────────────────────

/**
 * Produce the one-sentence "what changed" summary for a monthly trend.
 * Examples:
 *   "Net worth increased $1,240 this month."
 *   "Cash flow improved by $380."
 */
export function trendSentence(
  label: string,
  value: number | null,
  verb: { up: string; down: string },
): string | null {
  if (value === null || value === undefined) return null;
  if (value === 0) return null;
  const action = value > 0 ? verb.up : verb.down;
  return `${label} ${action} ${formatMoneyAbs(value)} this month.`;
}

// ─── Monthly trends summary sentences ────────────────────────────────────────

export function buildTrendSentences(trends: MonthlyTrends): string[] {
  const lines: string[] = [];
  const add = (s: string | null) => s && lines.push(s);
  add(trendSentence('Net worth', trends.netWorth,  { up: 'increased', down: 'decreased' }));
  add(trendSentence('Cash',      trends.cash,       { up: 'increased', down: 'decreased' }));
  add(trendSentence('Debt',      trends.debt,       { up: 'increased', down: 'decreased' }));
  add(trendSentence('Investments', trends.investments, { up: 'grew by', down: 'dropped by' }));
  add(trendSentence('Estimated tax', trends.estimatedTax, { up: 'owed increased', down: 'owed decreased' }));
  return lines;
}
