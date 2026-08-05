/**
 * account-matching-gate.test.ts
 *
 * Tests for the Task #39 additions to account-matching.ts:
 *   - isStaleStatement detection
 *   - staleStatementReason populated when stale
 *   - requiresConfirmation forced true for stale matches
 *   - autoMatchAllowed = false for stale matches
 *   - ≥2 matching signals required for autoMatchAllowed
 *   - institution-name-only matches blocked (score < 85 threshold)
 */

import { describe, it, expect } from 'vitest';
import {
  scoreAccountCandidate,
  matchExistingAccount,
  type ExtractedAccountIdentity,
  type MatchableAccount,
} from '../account-matching';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAccount(overrides?: Partial<MatchableAccount>): MatchableAccount {
  return {
    id: 'acct-1',
    name: 'Checking Account',
    institutionName: 'First National Bank',
    accountType: 'Checking Account',
    lastFour: '4521',
    balance: 5000,
    lastUpdatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

function makeExtracted(overrides?: Partial<ExtractedAccountIdentity>): ExtractedAccountIdentity {
  return {
    institutionName: 'First National Bank',
    accountName: 'Checking Account',
    accountType: 'Checking Account',
    lastFour: '4521',
    balance: 5100,
    statementDate: '2026-07-01',
    ...overrides,
  };
}

// ─── Staleness tests ──────────────────────────────────────────────────────────

describe('scoreAccountCandidate — staleness', () => {
  it('isStaleStatement is false when statement date is recent', () => {
    const candidate = scoreAccountCandidate(
      makeExtracted({ statementDate: '2026-07-14' }),
      makeAccount({ lastUpdatedAt: '2026-07-15T00:00:00.000Z' }),
    );
    expect(candidate.isStaleStatement).toBe(false);
    expect(candidate.staleStatementReason).toBeUndefined();
  });

  it('isStaleStatement is false when no statement date is provided', () => {
    const candidate = scoreAccountCandidate(
      makeExtracted({ statementDate: null }),
      makeAccount(),
    );
    expect(candidate.isStaleStatement).toBe(false);
  });

  it('isStaleStatement is true when statement is > 30 days older than account', () => {
    const candidate = scoreAccountCandidate(
      makeExtracted({ statementDate: '2026-01-01' }),
      makeAccount({ lastUpdatedAt: '2026-07-15T00:00:00.000Z' }),
    );
    expect(candidate.isStaleStatement).toBe(true);
    expect(candidate.staleStatementReason).toMatch(/older than/);
  });

  it('requiresConfirmation is true when isStaleStatement is true', () => {
    const candidate = scoreAccountCandidate(
      makeExtracted({ statementDate: '2026-01-01' }),
      makeAccount({ lastUpdatedAt: '2026-07-15T00:00:00.000Z' }),
    );
    expect(candidate.requiresConfirmation).toBe(true);
  });

  it('isStaleStatement is false when no lastUpdatedAt on account', () => {
    const candidate = scoreAccountCandidate(
      makeExtracted({ statementDate: '2026-01-01' }),
      makeAccount({ lastUpdatedAt: undefined }),
    );
    expect(candidate.isStaleStatement).toBe(false);
  });
});

describe('matchExistingAccount — stale statement blocks autoMatch', () => {
  it('autoMatchAllowed = false when statement is stale', () => {
    const result = matchExistingAccount(
      makeExtracted({ statementDate: '2026-01-01' }),
      [makeAccount({ lastUpdatedAt: '2026-07-15T00:00:00.000Z' })],
    );
    expect(result.autoMatchAllowed).toBe(false);
    expect(result.reason).toMatch(/stale|older|Statement/i);
  });

  it('autoMatchAllowed = true when match is high-confidence and not stale', () => {
    const result = matchExistingAccount(
      makeExtracted({ statementDate: '2026-07-14' }),
      [makeAccount({ lastUpdatedAt: '2026-07-15T00:00:00.000Z' })],
    );
    expect(result.autoMatchAllowed).toBe(true);
  });
});

// ─── ≥2 signal guard ─────────────────────────────────────────────────────────

describe('matchExistingAccount — ≥2 signal guard', () => {
  it('autoMatchAllowed requires exactLastFour plus at least one other signal', () => {
    // With only lastFour matching (score 55 → not high confidence), auto-match not allowed
    const lowSignalResult = matchExistingAccount(
      {
        lastFour: '4521',
        institutionName: null,
        accountName: null,
        accountType: null,
        balance: null,
        statementDate: null,
      },
      [makeAccount({ institutionName: undefined, accountType: undefined, name: 'Unknown' })],
    );
    // Score should be ~55 → medium confidence → autoMatchAllowed = false
    expect(lowSignalResult.autoMatchAllowed).toBe(false);
  });

  it('institution-name-only match does not reach auto-match threshold', () => {
    // Institution only: score ≈ 20 → below 85 threshold → confidence !== high
    const result = matchExistingAccount(
      {
        lastFour: null,
        institutionName: 'First National Bank',
        accountName: null,
        accountType: null,
        balance: null,
        statementDate: null,
      },
      [makeAccount({ lastFour: undefined })],
    );
    expect(result.autoMatchAllowed).toBe(false);
    expect(result.recommended?.confidence).not.toBe('high');
  });
});

// ─── isStaleStatement boundary conditions ─────────────────────────────────────

describe('scoreAccountCandidate — staleness boundary at exactly 30 days', () => {
  it('is not stale when exactly 30 days older', () => {
    const candidate = scoreAccountCandidate(
      makeExtracted({ statementDate: '2026-06-15' }),
      makeAccount({ lastUpdatedAt: '2026-07-15T00:00:00.000Z' }),
    );
    // 30 days diff → NOT stale (threshold is > 30)
    expect(candidate.isStaleStatement).toBe(false);
  });

  it('is stale when 31 days older', () => {
    const candidate = scoreAccountCandidate(
      makeExtracted({ statementDate: '2026-06-14' }),
      makeAccount({ lastUpdatedAt: '2026-07-15T00:00:00.000Z' }),
    );
    expect(candidate.isStaleStatement).toBe(true);
  });
});
