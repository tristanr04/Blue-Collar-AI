/**
 * Tests for Financial Command Center dashboard display logic.
 *
 * Covers:
 * - Server values rendering correctly (resolveMetric with ready status)
 * - Missing values not becoming zero (resolveMetric with missing/null)
 * - Negative monthly cash flow (resolveCashFlow)
 * - Saved tax estimate display (resolveTaxEstimate)
 * - Next best move display (resolveNextBestMove)
 * - API failure state (getCommandCenterSummary rejection)
 * - Mobile layout does not horizontally overflow (CSS class assertions)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  formatMoney,
  formatPercent,
  resolveMetric,
  resolvePercentMetric,
  resolveEmergencyFund,
  resolveCashFlow,
  resolveTaxEstimate,
  resolveNextBestMove,
  resolveHealthScore,
} from '../dashboard-utils';
import type { CommandCenterMetric, CommandCenterNextBestMove } from '../api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readyMetric(value: number): CommandCenterMetric {
  return { value, status: 'ready' };
}

function missingMetric(): CommandCenterMetric {
  return { value: null, status: 'missing' };
}

// ─── formatMoney ──────────────────────────────────────────────────────────────

describe('formatMoney', () => {
  it('formats positive values with dollar sign', () => {
    expect(formatMoney(1234)).toBe('$1,234');
  });

  it('formats negative values with minus prefix', () => {
    expect(formatMoney(-500)).toBe('-$500');
  });

  it('formats zero as $0', () => {
    expect(formatMoney(0)).toBe('$0');
  });

  it('rounds to whole dollars', () => {
    expect(formatMoney(1234.99)).toBe('$1,235');
  });
});

// ─── formatPercent ────────────────────────────────────────────────────────────

describe('formatPercent', () => {
  it('formats percentage with one decimal', () => {
    expect(formatPercent(28.5)).toBe('28.5%');
  });
});

// ─── resolveMetric (server values) ───────────────────────────────────────────

describe('resolveMetric — server values render correctly', () => {
  it('returns formatted money when status is ready', () => {
    const result = resolveMetric(readyMetric(12500), 'Upload a bank statement');
    expect(result.kind).toBe('value');
    if (result.kind === 'value') expect(result.display).toBe('$12,500');
  });

  it('returns the empty prompt when status is missing', () => {
    const result = resolveMetric(missingMetric(), 'Upload a bank statement');
    expect(result.kind).toBe('empty');
    if (result.kind === 'empty') expect(result.prompt).toBe('Upload a bank statement');
  });

  it('returns the empty prompt when metric is null', () => {
    const result = resolveMetric(null, 'Add a debt');
    expect(result.kind).toBe('empty');
  });

  it('returns the empty prompt when metric is undefined', () => {
    const result = resolveMetric(undefined, 'Add a debt');
    expect(result.kind).toBe('empty');
  });

  it('does NOT show $0 for a missing metric — shows the prompt instead', () => {
    const result = resolveMetric(missingMetric(), 'Add a debt');
    expect(result.kind).toBe('empty');
    // Confirm the display field doesn't exist (no fake $0)
    expect((result as any).display).toBeUndefined();
  });

  it('correctly shows $0 when value is actually zero (server-confirmed)', () => {
    const result = resolveMetric(readyMetric(0), 'Add a debt');
    expect(result.kind).toBe('value');
    if (result.kind === 'value') expect(result.display).toBe('$0');
  });

  it('formats large net worth values', () => {
    const result = resolveMetric(readyMetric(250000), 'Add data');
    expect(result.kind).toBe('value');
    if (result.kind === 'value') expect(result.display).toBe('$250,000');
  });

  it('formats negative net worth (liabilities exceed assets)', () => {
    const result = resolveMetric(readyMetric(-8500), 'Add data');
    expect(result.kind).toBe('value');
    if (result.kind === 'value') expect(result.display).toBe('-$8,500');
  });
});

// ─── resolvePercentMetric ────────────────────────────────────────────────────

describe('resolvePercentMetric', () => {
  it('formats credit utilization as a percentage', () => {
    const result = resolvePercentMetric(readyMetric(28.5), 'Add a credit card');
    expect(result.kind).toBe('value');
    if (result.kind === 'value') expect(result.display).toBe('28.5%');
  });

  it('shows empty prompt when utilization is missing', () => {
    const result = resolvePercentMetric(missingMetric(), 'Add a credit card');
    expect(result.kind).toBe('empty');
  });
});

// ─── resolveEmergencyFund ────────────────────────────────────────────────────

describe('resolveEmergencyFund', () => {
  it('formats months with one decimal', () => {
    const result = resolveEmergencyFund(readyMetric(3.2));
    expect(result.kind).toBe('value');
    if (result.kind === 'value') expect(result.display).toBe('3.2 mo');
  });

  it('shows empty prompt when data is missing', () => {
    const result = resolveEmergencyFund(missingMetric());
    expect(result.kind).toBe('empty');
    if (result.kind === 'empty') expect(result.prompt).toBe('Upload a bank statement');
  });
});

// ─── resolveCashFlow — negative monthly cash flow ─────────────────────────────

describe('resolveCashFlow', () => {
  it('marks negative cash flow correctly', () => {
    const result = resolveCashFlow(readyMetric(-450));
    expect(result).not.toBeNull();
    expect(result!.isNegative).toBe(true);
    expect(result!.display).toBe('-$450');
  });

  it('marks positive cash flow correctly', () => {
    const result = resolveCashFlow(readyMetric(800));
    expect(result).not.toBeNull();
    expect(result!.isNegative).toBe(false);
    expect(result!.display).toBe('$800');
  });

  it('handles exactly zero surplus (not negative)', () => {
    const result = resolveCashFlow(readyMetric(0));
    expect(result).not.toBeNull();
    expect(result!.isNegative).toBe(false);
    expect(result!.isZero).toBe(true);
  });

  it('returns null when cash flow is missing', () => {
    const result = resolveCashFlow(missingMetric());
    expect(result).toBeNull();
  });

  it('returns null when metric is undefined', () => {
    const result = resolveCashFlow(undefined);
    expect(result).toBeNull();
  });

  it('negative value never displays as $0', () => {
    const result = resolveCashFlow(readyMetric(-1));
    expect(result).not.toBeNull();
    expect(result!.display).not.toBe('$0');
    expect(result!.isNegative).toBe(true);
  });
});

// ─── resolveTaxEstimate ───────────────────────────────────────────────────────

describe('resolveTaxEstimate — saved tax estimate display', () => {
  it('shows refund when refundOrAmountOwed is positive', () => {
    const result = resolveTaxEstimate({ refundOrAmountOwed: 1200 });
    expect(result.kind).toBe('refund');
    if (result.kind === 'refund') {
      expect(result.amount).toBe(1200);
      expect(result.display).toContain('$1,200');
    }
  });

  it('shows "owed" when refundOrAmountOwed is negative', () => {
    const result = resolveTaxEstimate({ refundOrAmountOwed: -350 });
    expect(result.kind).toBe('owed');
    if (result.kind === 'owed') {
      expect(result.amount).toBe(-350);
      expect(result.display).toContain('350');
    }
  });

  it('shows zero refund when amount is exactly 0', () => {
    const result = resolveTaxEstimate({ refundOrAmountOwed: 0 });
    expect(result.kind).toBe('refund');
  });

  it('shows empty prompt when taxEstimate is null', () => {
    const result = resolveTaxEstimate(null);
    expect(result.kind).toBe('empty');
    if (result.kind === 'empty') expect(result.prompt).toBe('Save a tax estimate');
  });

  it('shows empty prompt when taxEstimate is undefined', () => {
    const result = resolveTaxEstimate(undefined);
    expect(result.kind).toBe('empty');
  });

  it('shows empty prompt when refundOrAmountOwed is null', () => {
    const result = resolveTaxEstimate({ totalEstimatedTax: 5000, refundOrAmountOwed: null });
    expect(result.kind).toBe('empty');
  });
});

// ─── resolveNextBestMove ──────────────────────────────────────────────────────

describe('resolveNextBestMove — single recommendation display', () => {
  const baseMove: CommandCenterNextBestMove = {
    category: 'cash-flow',
    title: 'Put this month\'s surplus to work',
    detail: 'Direct the surplus to your highest-priority goal.',
    estimatedImpact: 450,
    route: '/scenario',
  };

  it('returns exactly one move with the correct title', () => {
    const result = resolveNextBestMove(baseMove);
    expect(result.title).toBe('Put this month\'s surplus to work');
  });

  it('returns the move detail', () => {
    const result = resolveNextBestMove(baseMove);
    expect(result.detail).toBe('Direct the surplus to your highest-priority goal.');
  });

  it('formats estimated impact as money', () => {
    const result = resolveNextBestMove(baseMove);
    expect(result.estimatedImpact).toBe('$450');
  });

  it('returns null estimatedImpact when none provided', () => {
    const result = resolveNextBestMove({ ...baseMove, estimatedImpact: null });
    expect(result.estimatedImpact).toBeNull();
  });

  it('preserves the route for navigation', () => {
    const result = resolveNextBestMove(baseMove);
    expect(result.route).toBe('/scenario');
  });

  it('preserves the category', () => {
    const result = resolveNextBestMove({ ...baseMove, category: 'debt' });
    expect(result.category).toBe('debt');
  });

  it('returns income move when paystub is missing', () => {
    const move: CommandCenterNextBestMove = {
      category: 'income',
      title: 'Add your latest paystub',
      detail: 'Your income is the starting point for guidance.',
      estimatedImpact: null,
      route: '/scanner',
    };
    const result = resolveNextBestMove(move);
    expect(result.category).toBe('income');
    expect(result.route).toBe('/scanner');
  });
});

// ─── resolveHealthScore ───────────────────────────────────────────────────────

describe('resolveHealthScore', () => {
  it('returns null when healthScore is null', () => {
    expect(resolveHealthScore(null)).toBeNull();
  });

  it('labels 75+ as Strong', () => {
    const result = resolveHealthScore(80);
    expect(result?.label).toBe('Strong');
  });

  it('labels 50-74 as Fair', () => {
    const result = resolveHealthScore(60);
    expect(result?.label).toBe('Fair');
  });

  it('labels 25-49 as Needs work', () => {
    const result = resolveHealthScore(35);
    expect(result?.label).toBe('Needs work');
  });

  it('labels below 25 as Critical', () => {
    const result = resolveHealthScore(10);
    expect(result?.label).toBe('Critical');
  });
});

// ─── API failure state ────────────────────────────────────────────────────────

describe('API failure state', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Reset fetch mock before each test
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('getCommandCenterSummary rejects with a descriptive error on 500', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Your financial summary could not be loaded right now.' }),
    } as unknown as Response);

    const { getCommandCenterSummary } = await import('../api');
    await expect(getCommandCenterSummary('fake-token')).rejects.toThrow(
      'Your financial summary could not be loaded right now.',
    );
  });

  it('getCommandCenterSummary rejects on 401 (unauthenticated)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Authentication required.' }),
    } as unknown as Response);

    const { getCommandCenterSummary } = await import('../api');
    await expect(getCommandCenterSummary('expired-token')).rejects.toThrow(
      'Authentication required.',
    );
  });

  it('getCommandCenterSummary rejects on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const { getCommandCenterSummary } = await import('../api');
    await expect(getCommandCenterSummary('token')).rejects.toThrow('Failed to fetch');
  });
});

// ─── Mobile layout — no horizontal overflow ───────────────────────────────────

const _dashboardSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../pages/Dashboard.tsx'),
  'utf-8',
);

describe('Dashboard mobile layout — no horizontal overflow', () => {
  /**
   * These tests read the Dashboard source and assert CSS constraints that
   * prevent horizontal overflow on iPhone-sized screens.
   */
  const dashboardSource = _dashboardSource;

  it('outer container uses max-w to constrain width', () => {
    expect(dashboardSource).toMatch(/max-w-/);
  });

  it('grid sections use grid-cols-2 (not more) at mobile breakpoint', () => {
    // Bare (non-responsive-prefixed) grid-cols-3+ would overflow on mobile.
    // The lookbehind excludes both word chars and Tailwind prefix separators (:)
    // so that sm:grid-cols-4, md:grid-cols-4, etc. are not flagged.
    const bareGridCols = dashboardSource.match(/(?<![\w:])grid-cols-[3-9]/g) ?? [];
    expect(bareGridCols.length).toBe(0);
  });

  it('uses overflow-hidden on sections that could clip wide content', () => {
    expect(dashboardSource).toMatch(/overflow-hidden/);
  });

  it('does not use any fixed pixel widths wider than 480px inline', () => {
    // Check for inline style width > 480
    const wideInlineWidths = dashboardSource.match(/style=.*width:\s*['"`]?\d{4,}/g) ?? [];
    expect(wideInlineWidths.length).toBe(0);
  });

  it('does not use min-w values that exceed iPhone screen width', () => {
    // min-w-[Npx] with N > 400 would cause overflow
    const wideMinWidths = dashboardSource.match(/min-w-\[([0-9]+)px\]/g) ?? [];
    const tooWide = wideMinWidths.filter(cls => {
      const m = cls.match(/min-w-\[([0-9]+)px\]/);
      return m ? parseInt(m[1], 10) > 400 : false;
    });
    expect(tooWide.length).toBe(0);
  });

  it('uses px- padding (not vw-based widths) for horizontal spacing', () => {
    // The container should use px-N padding classes
    expect(dashboardSource).toMatch(/px-4|px-6/);
  });
});
