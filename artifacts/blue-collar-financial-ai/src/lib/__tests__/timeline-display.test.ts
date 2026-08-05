/**
 * Tests for Financial Timeline display-logic helpers.
 *
 * Covers:
 * - Monthly trend calculations (pure)
 * - Missing values remain null (not zero)
 * - Timeline API failure state
 * - Mobile layout does not horizontally overflow (CSS assertions)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  formatMoney,
  formatMoneyAbs,
  resolveChange,
  resolveTrend,
  getEventCategory,
  formatEventDate,
  trendSentence,
  buildTrendSentences,
} from '../timeline-utils';
import type { MonthlyTrends } from '../api';

// ─── formatMoney ──────────────────────────────────────────────────────────────

describe('formatMoney', () => {
  it('formats positive numbers', () => {
    expect(formatMoney(1500)).toBe('$1,500');
  });
  it('formats negative numbers with minus prefix', () => {
    expect(formatMoney(-300)).toBe('-$300');
  });
  it('formats zero as $0', () => {
    expect(formatMoney(0)).toBe('$0');
  });
});

// ─── resolveChange ────────────────────────────────────────────────────────────

describe('resolveChange — monthly trend calculations', () => {
  it('returns kind=increase for positive change', () => {
    const r = resolveChange(500);
    expect(r.kind).toBe('increase');
    if (r.kind === 'increase') expect(r.label).toContain('500');
  });

  it('returns kind=decrease for negative change', () => {
    const r = resolveChange(-300);
    expect(r.kind).toBe('decrease');
    if (r.kind === 'decrease') expect(r.amount).toBe(-300);
  });

  it('returns kind=none for zero', () => {
    expect(resolveChange(0).kind).toBe('none');
  });

  it('returns kind=none for null (missing — not zero)', () => {
    expect(resolveChange(null).kind).toBe('none');
  });

  it('returns kind=none for undefined', () => {
    expect(resolveChange(undefined).kind).toBe('none');
  });
});

// ─── resolveTrend — missing values remain null (not zero) ────────────────────

describe('resolveTrend — null never becomes zero', () => {
  it('returns kind=empty for null value', () => {
    const r = resolveTrend(null, 'No data yet');
    expect(r.kind).toBe('empty');
    if (r.kind === 'empty') expect(r.prompt).toBe('No data yet');
  });

  it('returns kind=empty for undefined value', () => {
    const r = resolveTrend(undefined, 'No data yet');
    expect(r.kind).toBe('empty');
  });

  it('does NOT return $0 for null input — returns empty prompt', () => {
    const r = resolveTrend(null, 'No data yet');
    expect(r.kind).toBe('empty');
    // Confirm no .label field (which would suggest a dollar amount)
    expect((r as any).label).toBeUndefined();
  });

  it('returns kind=neutral for confirmed zero', () => {
    const r = resolveTrend(0, 'No data yet');
    expect(r.kind).toBe('neutral');
    if (r.kind === 'neutral') expect(r.amount).toBe(0);
  });

  it('returns kind=positive for positive value', () => {
    const r = resolveTrend(1200, 'No data yet');
    expect(r.kind).toBe('positive');
    if (r.kind === 'positive') expect(r.amount).toBe(1200);
  });

  it('returns kind=negative for negative value when negativeIsBad=true', () => {
    const r = resolveTrend(-500, 'No data yet', true);
    expect(r.kind).toBe('negative');
  });
});

// ─── trendSentence ────────────────────────────────────────────────────────────

describe('trendSentence', () => {
  it('generates a sentence for positive net worth change', () => {
    const s = trendSentence('Net worth', 1240, { up: 'increased', down: 'decreased' });
    expect(s).toContain('1,240');
    expect(s).toContain('increased');
    expect(s).toContain('this month');
  });

  it('generates a sentence for negative change', () => {
    const s = trendSentence('Debt', -380, { up: 'increased', down: 'decreased' });
    expect(s).toContain('decreased');
    expect(s).toContain('380');
  });

  it('returns null for zero', () => {
    expect(trendSentence('Cash', 0, { up: 'up', down: 'down' })).toBeNull();
  });

  it('returns null for null value', () => {
    expect(trendSentence('Cash', null, { up: 'up', down: 'down' })).toBeNull();
  });
});

// ─── buildTrendSentences ──────────────────────────────────────────────────────

describe('buildTrendSentences', () => {
  it('returns only sentences for non-null, non-zero trend values', () => {
    const trends: MonthlyTrends = {
      netWorth: 1200,
      cash: null,
      debt: null,
      investments: 500,
      retirement: null,
      estimatedTax: null,
    };
    const sentences = buildTrendSentences(trends);
    expect(sentences.length).toBe(2);
    expect(sentences.some((s) => s.includes('Net worth'))).toBe(true);
    expect(sentences.some((s) => s.includes('Investments'))).toBe(true);
  });

  it('returns empty array when all trends are null', () => {
    const trends: MonthlyTrends = {
      netWorth: null, cash: null, debt: null,
      investments: null, retirement: null, estimatedTax: null,
    };
    expect(buildTrendSentences(trends)).toHaveLength(0);
  });
});

// ─── getEventCategory ────────────────────────────────────────────────────────

describe('getEventCategory', () => {
  it('returns Income label for paystub events', () => {
    expect(getEventCategory('paystub_added').label).toBe('Income');
    expect(getEventCategory('paystub_updated').label).toBe('Income');
  });

  it('returns Cash label for bank balance events', () => {
    expect(getEventCategory('bank_balance_updated').label).toBe('Cash');
  });

  it('returns Taxes label for tax estimate events', () => {
    expect(getEventCategory('tax_estimate_saved').label).toBe('Taxes');
  });

  it('returns a fallback for unknown event types', () => {
    const cat = getEventCategory('unknown_type');
    expect(cat.label).toBeDefined();
    expect(cat.colorClass).toBeDefined();
  });
});

// ─── formatEventDate ─────────────────────────────────────────────────────────

describe('formatEventDate', () => {
  it('formats a Date object as a readable string', () => {
    const d = new Date('2026-07-15T12:00:00Z');
    const str = formatEventDate(d);
    expect(str).toContain('Jul');
    expect(str).toContain('15');
  });

  it('formats an ISO string', () => {
    const str = formatEventDate('2026-03-01T00:00:00Z');
    expect(str).toContain('Mar');
  });
});

// ─── Timeline API failure state ───────────────────────────────────────────────

describe('Timeline API failure state', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => { globalThis.fetch = originalFetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('getTimelineSummary rejects with a descriptive error on 500', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Your financial timeline could not be loaded right now.' }),
    } as unknown as Response);

    const { getTimelineSummary } = await import('../api');
    await expect(getTimelineSummary('fake-token')).rejects.toThrow(
      'Your financial timeline could not be loaded right now.',
    );
  });

  it('getTimelineSummary rejects on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Authentication required.' }),
    } as unknown as Response);

    const { getTimelineSummary } = await import('../api');
    await expect(getTimelineSummary('expired')).rejects.toThrow('Authentication required.');
  });

  it('getTimelineSummary rejects on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const { getTimelineSummary } = await import('../api');
    await expect(getTimelineSummary('token')).rejects.toThrow('Failed to fetch');
  });
});

// ─── Mobile layout — no horizontal overflow ───────────────────────────────────

const _timelineSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../pages/Timeline.tsx'),
  'utf-8',
);

describe('Timeline mobile layout — no horizontal overflow', () => {
  const src = _timelineSource;

  it('outer container uses max-w to constrain width', () => {
    expect(src).toMatch(/max-w-/);
  });

  it('grid sections use at most grid-cols-2 at base breakpoint', () => {
    // bare (non-prefixed) grid-cols-3+ would overflow on mobile
    const bare = src.match(/(?<![\w:])grid-cols-[3-9]/g) ?? [];
    expect(bare.length).toBe(0);
  });

  it('uses px- padding for horizontal spacing', () => {
    expect(src).toMatch(/px-4|px-6/);
  });

  it('does not use inline widths wider than 400px', () => {
    const wide = src.match(/style=.*width:\s*['"`]?\d{4,}/g) ?? [];
    expect(wide.length).toBe(0);
  });
});
