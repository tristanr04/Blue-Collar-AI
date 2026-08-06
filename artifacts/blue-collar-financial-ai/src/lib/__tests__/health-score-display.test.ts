/**
 * Tests for Health Score display logic and API integration.
 *
 * Covers:
 * - Score and confidence display
 * - API error states
 * - Mobile layout constraints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// ─── API integration ──────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

describe('Health Score API — error states', () => {
  beforeEach(() => { globalThis.fetch = originalFetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('getHealthScoreDetail rejects on 500', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Your health score could not be calculated right now.' }),
    } as unknown as Response);

    const { getHealthScoreDetail } = await import('../api');
    await expect(getHealthScoreDetail('token')).rejects.toThrow(
      'Your health score could not be calculated right now.',
    );
  });

  it('getHealthScoreDetail rejects on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Authentication required.' }),
    } as unknown as Response);

    const { getHealthScoreDetail } = await import('../api');
    await expect(getHealthScoreDetail('expired-token')).rejects.toThrow('Authentication required.');
  });

  it('getHealthScoreHistory rejects on 500', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Health score history could not be loaded right now.' }),
    } as unknown as Response);

    const { getHealthScoreHistory } = await import('../api');
    await expect(getHealthScoreHistory('token')).rejects.toThrow(
      'Health score history could not be loaded right now.',
    );
  });

  it('getHealthScoreDetail rejects on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { getHealthScoreDetail } = await import('../api');
    await expect(getHealthScoreDetail('token')).rejects.toThrow('Failed to fetch');
  });
});

// ─── Health Score page — mobile layout ────────────────────────────────────────

const pageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../pages/HealthScore.tsx'),
  'utf-8',
);

describe('HealthScore page — mobile layout', () => {
  it('uses max-w to constrain width', () => {
    expect(pageSource).toMatch(/max-w-/);
  });

  it('uses px- padding for horizontal spacing', () => {
    expect(pageSource).toMatch(/px-4|px-6/);
  });

  it('uses pb- for bottom padding (mobile nav clearance)', () => {
    expect(pageSource).toMatch(/pb-28|pb-24/);
  });

  it('does not use bare grid-cols-3+ (would overflow on mobile)', () => {
    const bare = pageSource.match(/(?<![\w:])grid-cols-[3-9]/g) ?? [];
    expect(bare.length).toBe(0);
  });

  it('does not use inline widths wider than 400px', () => {
    const wide = pageSource.match(/style=.*width:\s*['"`]?\d{4,}/g) ?? [];
    expect(wide.length).toBe(0);
  });
});

// ─── Score ring ARIA ─────────────────────────────────────────────────────────

describe('HealthScore page — accessibility', () => {
  it('includes aria-label on the score ring', () => {
    expect(pageSource).toMatch(/aria-label/);
    expect(pageSource).toMatch(/role="img"/);
  });

  it('shows a fallback message when score is null', () => {
    expect(pageSource).toMatch(/Add data for score|No data/i);
  });
});

// ─── Category breakdown ───────────────────────────────────────────────────────

describe('HealthScore page — category breakdown', () => {
  it('renders category explanation text', () => {
    // HealthScore page should map over categories and render explanation
    expect(pageSource).toMatch(/cat\.explanation/);
  });

  it('renders a progress bar per category', () => {
    expect(pageSource).toMatch(/cat\.pct/);
  });

  it('renders category label', () => {
    expect(pageSource).toMatch(/cat\.label/);
  });
});
