import { describe, expect, it } from 'vitest';
import {
  isDuplicateFingerprint,
  matchExistingAccount,
  scoreAccountCandidate,
  sha256Hex,
} from './account-matching';

const accounts = [
  {
    id: 'checking-1',
    name: 'Primary Checking',
    institutionName: 'Chase Bank',
    accountType: 'Checking Account',
    lastFour: '1122',
    balance: 2400,
  },
  {
    id: 'checking-2',
    name: 'Job Travel Checking',
    institutionName: 'Chase',
    accountType: 'Checking Account',
    lastFour: '3344',
    balance: 800,
  },
  {
    id: 'card-1',
    name: 'Freedom Unlimited',
    institutionName: 'JPMorgan Chase',
    accountType: 'Credit Card',
    lastFour: '7788',
    balance: 3800,
  },
];

describe('account matching', () => {
  it('allows a unique exact-last-four match', () => {
    const result = matchExistingAccount(
      {
        institutionName: 'Chase',
        accountType: 'Checking',
        lastFour: '3344',
        balance: 810,
      },
      accounts,
    );

    expect(result.recommended?.account.id).toBe('checking-2');
    expect(result.autoMatchAllowed).toBe(true);
  });

  it('never auto-matches using institution alone when multiple accounts exist', () => {
    const result = matchExistingAccount(
      {
        institutionName: 'Chase Bank',
        accountType: 'Checking Account',
      },
      accounts,
    );

    expect(result.autoMatchAllowed).toBe(false);
    expect(result.recommended?.requiresConfirmation).toBe(true);
  });

  it('penalizes conflicting account digits', () => {
    const candidate = scoreAccountCandidate(
      {
        institutionName: 'Chase',
        accountType: 'Checking Account',
        lastFour: '9999',
      },
      accounts[0],
    );

    expect(candidate.missingSignals).toContain('Account last four conflicts');
    expect(candidate.score).toBeLessThan(35);
  });

  it('does not confuse a credit card and checking account at one institution', () => {
    const result = matchExistingAccount(
      {
        institutionName: 'Chase',
        accountType: 'Credit Card',
        lastFour: '7788',
      },
      accounts,
    );

    expect(result.recommended?.account.id).toBe('card-1');
    expect(result.autoMatchAllowed).toBe(true);
  });
});

describe('content fingerprints', () => {
  it('returns stable SHA-256 hashes', async () => {
    const first = await sha256Hex('same statement contents');
    const second = await sha256Hex('same statement contents');
    const different = await sha256Hex('different statement contents');

    expect(first).toBe(second);
    expect(first).not.toBe(different);
    expect(first).toHaveLength(64);
  });

  it('detects duplicates independent of filename metadata', async () => {
    const fingerprint = await sha256Hex('statement bytes');
    expect(isDuplicateFingerprint(fingerprint, [fingerprint.toUpperCase()])).toBe(true);
  });
});
