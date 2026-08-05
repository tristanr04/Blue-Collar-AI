/**
 * Pure display-logic helpers for the Financial Command Center dashboard.
 * Kept in a separate module so they can be unit-tested without a DOM.
 */

import type { CommandCenterMetric, CommandCenterTaxEstimate, CommandCenterNextBestMove } from './api';

// ─── Money formatting ──────────────────────────────────────────────────────────

/** Format a number as a compact dollar amount (no cents). */
export function formatMoney(value: number): string {
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return value < 0 ? `-$${formatted}` : `$${formatted}`;
}

/** Format a number as a percentage with one decimal place. */
export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

// ─── Metric resolution ─────────────────────────────────────────────────────────

export type MetricDisplay =
  | { kind: 'value'; display: string }
  | { kind: 'empty'; prompt: string };

/**
 * Resolve a server CommandCenterMetric to either a formatted dollar string
 * or a contextual empty-state prompt.
 * A null or missing metric never shows as "$0".
 */
export function resolveMetric(
  metric: CommandCenterMetric | null | undefined,
  emptyPrompt: string,
): MetricDisplay {
  if (!metric || metric.status === 'missing' || metric.value === null) {
    return { kind: 'empty', prompt: emptyPrompt };
  }
  return { kind: 'value', display: formatMoney(metric.value) };
}

/**
 * Like resolveMetric but formats as a percentage (for credit utilization).
 */
export function resolvePercentMetric(
  metric: CommandCenterMetric | null | undefined,
  emptyPrompt: string,
): MetricDisplay {
  if (!metric || metric.status === 'missing' || metric.value === null) {
    return { kind: 'empty', prompt: emptyPrompt };
  }
  return { kind: 'value', display: formatPercent(metric.value) };
}

/**
 * Resolve emergency fund months. Returns e.g. "3.2 months" or an empty prompt.
 */
export function resolveEmergencyFund(
  metric: CommandCenterMetric | null | undefined,
): MetricDisplay {
  if (!metric || metric.status === 'missing' || metric.value === null) {
    return { kind: 'empty', prompt: 'Upload a bank statement' };
  }
  return { kind: 'value', display: `${metric.value.toFixed(1)} mo` };
}

// ─── Cash flow resolution ──────────────────────────────────────────────────────

export type CashFlowDisplay = {
  display: string;
  isNegative: boolean;
  isZero: boolean;
} | null;

/**
 * Resolve the monthlyCashFlow metric to a signed display string.
 * Returns null when the value is missing so callers can show an empty state.
 */
export function resolveCashFlow(
  metric: CommandCenterMetric | null | undefined,
): CashFlowDisplay {
  if (!metric || metric.status === 'missing' || metric.value === null) {
    return null;
  }
  return {
    display: formatMoney(metric.value),
    isNegative: metric.value < 0,
    isZero: metric.value === 0,
  };
}

// ─── Tax estimate resolution ───────────────────────────────────────────────────

export type TaxDisplay =
  | { kind: 'refund'; display: string; amount: number }
  | { kind: 'owed'; display: string; amount: number }
  | { kind: 'empty'; prompt: string };

/**
 * Resolve a server tax estimate to a "refund" or "owed" display,
 * or an empty-state prompt when no saved estimate exists.
 */
export function resolveTaxEstimate(
  taxEstimate: CommandCenterTaxEstimate | null | undefined,
): TaxDisplay {
  if (!taxEstimate) {
    return { kind: 'empty', prompt: 'Save a tax estimate' };
  }
  const amount = taxEstimate.refundOrAmountOwed ?? null;
  if (amount === null) {
    return { kind: 'empty', prompt: 'Save a tax estimate' };
  }
  if (amount >= 0) {
    return { kind: 'refund', display: `+${formatMoney(amount)}`, amount };
  }
  return { kind: 'owed', display: formatMoney(amount), amount };
}

// ─── Next best move ────────────────────────────────────────────────────────────

export type NextBestMoveDisplay = {
  title: string;
  detail: string;
  estimatedImpact: string | null;
  route: string;
  category: CommandCenterNextBestMove['category'];
};

/**
 * Resolve the next best move to a display-ready object.
 * Always returns exactly one recommendation.
 */
export function resolveNextBestMove(
  move: CommandCenterNextBestMove,
): NextBestMoveDisplay {
  return {
    title: move.title,
    detail: move.detail,
    estimatedImpact: move.estimatedImpact !== null ? formatMoney(move.estimatedImpact) : null,
    route: move.route,
    category: move.category,
  };
}

// ─── Health score ─────────────────────────────────────────────────────────────

export type HealthScoreDisplay = {
  score: number;
  label: string;
  color: string;       // Tailwind text colour class
  ringColor: string;   // CSS colour for the conic-gradient
} | null;

export function resolveHealthScore(score: number | null): HealthScoreDisplay {
  if (score === null) return null;
  if (score >= 75) return { score, label: 'Strong',   color: 'text-emerald-300', ringColor: '#22c55e' };
  if (score >= 50) return { score, label: 'Fair',     color: 'text-amber-300',   ringColor: '#f59e0b' };
  if (score >= 25) return { score, label: 'Needs work', color: 'text-orange-400', ringColor: '#f97316' };
  return             { score, label: 'Critical',  color: 'text-rose-400',   ringColor: '#ef4444' };
}
