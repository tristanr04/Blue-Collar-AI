export type MatchConfidence = 'high' | 'medium' | 'low' | 'none';

export interface MatchableAccount {
  id: string;
  name: string;
  institutionName?: string;
  accountType?: string;
  lastFour?: string;
  balance?: number;
  lastUpdatedAt?: string;
}

export interface ExtractedAccountIdentity {
  institutionName?: string | null;
  accountName?: string | null;
  accountType?: string | null;
  lastFour?: string | null;
  balance?: number | null;
  statementDate?: string | null;
}

export interface AccountMatchCandidate {
  account: MatchableAccount;
  score: number;
  confidence: MatchConfidence;
  matchedSignals: string[];
  missingSignals: string[];
  requiresConfirmation: boolean;
}

export interface AccountMatchResult {
  recommended: AccountMatchCandidate | null;
  candidates: AccountMatchCandidate[];
  autoMatchAllowed: boolean;
  reason: string;
}

function normalizeText(value?: string | null): string {
  return (value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenize(value?: string | null): Set<string> {
  return new Set(
    normalizeText(value)
      .split(' ')
      .filter((token) => token.length > 1),
  );
}

function tokenSimilarity(a?: string | null, b?: string | null): number {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 || right.size === 0) return 0;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / Math.max(left.size, right.size);
}

function normalizeLastFour(value?: string | null): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function finiteBalance(value?: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function balanceSimilarity(a?: number | null, b?: number | null): number {
  const left = finiteBalance(a);
  const right = finiteBalance(b);
  if (left === null || right === null) return 0;
  const denominator = Math.max(left, right, 1);
  const relativeDifference = Math.abs(left - right) / denominator;
  if (relativeDifference <= 0.01) return 1;
  if (relativeDifference <= 0.05) return 0.7;
  if (relativeDifference <= 0.15) return 0.35;
  return 0;
}

function confidenceForScore(score: number): MatchConfidence {
  // 85+ treats an exact-last-four + institution + type match as high confidence.
  // Pure institution-only matches top out at ~32, well below this threshold.
  if (score >= 85) return 'high';
  if (score >= 65) return 'medium';
  if (score >= 35) return 'low';
  return 'none';
}

export function scoreAccountCandidate(
  extracted: ExtractedAccountIdentity,
  account: MatchableAccount,
): AccountMatchCandidate {
  let score = 0;
  const matchedSignals: string[] = [];
  const missingSignals: string[] = [];

  const extractedLastFour = normalizeLastFour(extracted.lastFour);
  const accountLastFour = normalizeLastFour(account.lastFour);
  if (extractedLastFour && accountLastFour) {
    if (extractedLastFour === accountLastFour) {
      score += 55;
      matchedSignals.push('Exact account last four');
    } else {
      score -= 80;
      missingSignals.push('Account last four conflicts');
    }
  } else {
    missingSignals.push('Account last four unavailable');
  }

  // Asymmetric institution matching: extracted names are user-typed abbreviations
  // (e.g. "Chase") while stored names may be the full legal name ("JPMorgan Chase").
  // Treat the match as exact when all extracted tokens appear in the account name.
  const extractedInstitutionTokens = tokenize(extracted.institutionName);
  const accountInstitutionTokens = tokenize(account.institutionName);
  const allExtractedPresent =
    extractedInstitutionTokens.size > 0 &&
    [...extractedInstitutionTokens].every((t) => accountInstitutionTokens.has(t));
  const institutionSimilarity = allExtractedPresent
    ? 1
    : tokenSimilarity(extracted.institutionName, account.institutionName);

  if (institutionSimilarity === 1) {
    score += 20;
    matchedSignals.push('Exact normalized institution');
  } else if (institutionSimilarity >= 0.6) {
    score += 12;
    matchedSignals.push('Similar institution name');
  } else if (extracted.institutionName && account.institutionName) {
    missingSignals.push('Institution does not closely match');
  }

  const typeSimilarity = tokenSimilarity(extracted.accountType, account.accountType);
  if (typeSimilarity === 1) {
    score += 12;
    matchedSignals.push('Exact account type');
  } else if (typeSimilarity >= 0.5) {
    score += 7;
    matchedSignals.push('Similar account type');
  } else if (extracted.accountType && account.accountType) {
    missingSignals.push('Account type does not match');
  }

  const nameSimilarity = tokenSimilarity(extracted.accountName, account.name);
  if (nameSimilarity >= 0.8) {
    score += 8;
    matchedSignals.push('Strong account-name match');
  } else if (nameSimilarity >= 0.5) {
    score += 4;
    matchedSignals.push('Partial account-name match');
  }

  const balanceMatch = balanceSimilarity(extracted.balance, account.balance);
  if (balanceMatch > 0) {
    score += Math.round(balanceMatch * 5);
    matchedSignals.push('Balance is reasonably close');
  }

  score = Math.max(0, Math.min(100, score));
  const confidence = confidenceForScore(score);

  return {
    account,
    score,
    confidence,
    matchedSignals,
    missingSignals,
    requiresConfirmation: confidence !== 'high',
  };
}

export function matchExistingAccount(
  extracted: ExtractedAccountIdentity,
  accounts: MatchableAccount[],
): AccountMatchResult {
  const candidates = accounts
    .map((account) => scoreAccountCandidate(extracted, account))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  const recommended = candidates[0] ?? null;
  const runnerUp = candidates[1] ?? null;

  if (!recommended) {
    return {
      recommended: null,
      candidates,
      autoMatchAllowed: false,
      reason: 'No existing account has enough matching information.',
    };
  }

  const extractedLastFour = normalizeLastFour(extracted.lastFour);
  const exactLastFour = recommended.matchedSignals.includes('Exact account last four');
  const uniqueMargin = !runnerUp || recommended.score - runnerUp.score >= 20;

  // Institution-only matching is never enough for an automatic update.
  const autoMatchAllowed =
    recommended.confidence === 'high' &&
    exactLastFour &&
    Boolean(extractedLastFour) &&
    uniqueMargin;

  return {
    recommended: { ...recommended, requiresConfirmation: !autoMatchAllowed },
    candidates,
    autoMatchAllowed,
    reason: autoMatchAllowed
      ? 'A unique high-confidence account match was found using exact account digits.'
      : 'User confirmation is required because the match is ambiguous or lacks exact account digits.',
  };
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  // Normalise to a plain ArrayBuffer so crypto.subtle.digest is compatible
  // across all TypeScript strictness levels.  Uint8Array<ArrayBufferLike> is
  // not assignable to ArrayBufferView in TS ≥ 5.7 because ArrayBufferView
  // requires buffer: ArrayBuffer (not ArrayBufferLike).
  // new Uint8Array(uint8Array) uses the ArrayLike<number> constructor overload
  // which always produces Uint8Array<ArrayBuffer> with a fresh backing buffer.
  const buf: ArrayBuffer =
    typeof data === 'string'
      ? new TextEncoder().encode(data).buffer
      : data instanceof Uint8Array
        ? new Uint8Array(data).buffer
        : data;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintFile(file: File): Promise<string> {
  return sha256Hex(await file.arrayBuffer());
}

export function isDuplicateFingerprint(
  fingerprint: string,
  existingFingerprints: Iterable<string>,
): boolean {
  const normalized = fingerprint.trim().toLowerCase();
  for (const existing of existingFingerprints) {
    if (existing.trim().toLowerCase() === normalized) return true;
  }
  return false;
}
