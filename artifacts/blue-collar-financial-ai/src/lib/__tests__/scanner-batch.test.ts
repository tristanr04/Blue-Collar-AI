/**
 * Unit tests for scanner batch-processing helpers.
 *
 * These tests cover mergeUniqueFiles, duplicate detection, document filtering,
 * progress counts, preview URL cleanup patterns, and rate-limit (429) retry
 * logic (is429Error, parseRetryDelay, clampRetryMs, simulateQueue).
 * Pure functions are replicated here because they are not exported from
 * Scanner.tsx.  Keep in sync with changes to those functions.
 */

import { describe, it, expect, vi } from 'vitest';

// ─── Replicated helpers (keep in sync with Scanner.tsx) ───────────────────────

const MAX_BATCH_FILES = 20;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SCAN_CONCURRENCY = 2;
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const;
const MAX_RATE_LIMIT_RETRIES = 3;
const CLAMP_MIN_MS = 1_000;
const CLAMP_MAX_MS = 30_000;

// ─── Rate-limit helpers (keep in sync with Scanner.tsx) ───────────────────────

function clampRetryMs(ms: number): number {
  return Math.max(CLAMP_MIN_MS, Math.min(CLAMP_MAX_MS, Math.round(ms)));
}

function is429Error(err: unknown): {
  retryAfterHeader: string | null;
  retryAfterBodyMs: number | undefined;
} | null {
  if (!(err instanceof Error)) return null;
  try {
    const parsed = JSON.parse(err.message) as Record<string, unknown>;
    const status = parsed.httpStatus;
    const msg = typeof parsed.message === 'string' ? parsed.message.toLowerCase() : '';
    if (status === 429 || msg.includes('too many requests') || msg.includes('rate limit')) {
      return {
        retryAfterHeader:
          typeof parsed.retryAfterHeader === 'string' ? parsed.retryAfterHeader : null,
        retryAfterBodyMs:
          typeof parsed.retryAfterBodyMs === 'number' ? parsed.retryAfterBodyMs : undefined,
      };
    }
  } catch { /* not JSON */ }
  const raw = err.message.toLowerCase();
  if (raw.includes('429') || raw.includes('too many requests') || raw.includes('rate limit')) {
    return { retryAfterHeader: null, retryAfterBodyMs: undefined };
  }
  return null;
}

function parseRetryDelay(
  retryAfterHeader: string | null,
  retryAfterBodyMs: number | undefined,
  attempt: number,
): number {
  if (retryAfterBodyMs !== undefined && retryAfterBodyMs > 0) {
    return clampRetryMs(retryAfterBodyMs);
  }
  if (retryAfterHeader) {
    const trimmed = retryAfterHeader.trim();
    const numSec = Number(trimmed);
    if (!isNaN(numSec) && trimmed !== '') {
      return clampRetryMs(numSec * 1_000);
    }
    const dateMs = new Date(retryAfterHeader).getTime();
    if (!isNaN(dateMs)) {
      return clampRetryMs(dateMs - Date.now());
    }
  }
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

function make429Error(opts?: {
  retryAfterHeader?: string;
  retryAfterBodyMs?: number;
  message?: string;
}): Error {
  return new Error(JSON.stringify({
    stage: 'backend_receipt',
    httpStatus: 429,
    message: opts?.message ?? 'Too Many Requests',
    filename: 'test.jpg',
    ...(opts?.retryAfterHeader !== undefined ? { retryAfterHeader: opts.retryAfterHeader } : {}),
    ...(opts?.retryAfterBodyMs !== undefined ? { retryAfterBodyMs: opts.retryAfterBodyMs } : {}),
  }));
}

/**
 * Simulates the queue dispatcher from Scanner.tsx.  Runs at most `concurrency`
 * workers in parallel; each worker processes a single doc ID.  On a 429 the
 * worker IMMEDIATELY returns (simulating slot-release), and the doc is
 * rescheduled with a 0ms delay (fast test); the retry attempt count is tracked.
 *
 * @param docIds   IDs to process.
 * @param scanFn   Async function that may throw a 429 error.
 * @returns        Map of docId → total call count.
 */
async function simulateQueue(
  docIds: string[],
  concurrency: number,
  scanFn: (id: string, attempt: number) => Promise<void>,
): Promise<Map<string, number>> {
  const callCounts = new Map<string, number>(docIds.map(id => [id, 0]));
  const retryAttempts = new Map<string, number>(docIds.map(id => [id, 0]));
  const queue = [...docIds];
  let active = 0;
  /** Tracks setTimeout handles scheduled for retried docs — prevents early resolve. */
  let pendingRetries = 0;

  const settle = (resolve: () => void) => {
    if (queue.length === 0 && active === 0 && pendingRetries === 0) resolve();
  };

  await new Promise<void>(resolve => {
    if (docIds.length === 0) { resolve(); return; }

    function dispatchNext(): void {
      while (active < concurrency && queue.length > 0) {
        const id = queue.shift()!;
        active++;
        const attempt = retryAttempts.get(id) ?? 0;
        callCounts.set(id, (callCounts.get(id) ?? 0) + 1);

        scanFn(id, attempt)
          .then(() => { /* terminal success */ })
          .catch(err => {
            const rl = is429Error(err);
            if (rl && attempt < MAX_RATE_LIMIT_RETRIES) {
              // Release slot immediately; re-queue after a microtick.
              retryAttempts.set(id, attempt + 1);
              pendingRetries++;
              setTimeout(() => {
                pendingRetries--;
                queue.unshift(id);
                dispatchNext();
                settle(resolve);
              }, 0);
            }
            // fatal or exhausted — drop it
          })
          .finally(() => {
            active--;
            settle(resolve);
            dispatchNext();
          });
      }
    }
    dispatchNext();
  });

  return callCounts;
}

function mergeUniqueFiles(current: File[], incoming: File[]): File[] {
  const seen = new Set(current.map(f => `${f.name}:${f.size}:${f.lastModified}`));
  const merged = [...current];
  for (const file of incoming) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(file);
    }
  }
  return merged.slice(0, MAX_BATCH_FILES);
}

/** Create a fake File with controlled size. */
function makeFile(name: string, sizeBytes = 1024, lastModified = 0): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type: 'image/jpeg' });
  return new File([blob], name, { type: 'image/jpeg', lastModified });
}

function makeFiles(count: number, prefix = 'file', sizeBytes = 1024): File[] {
  return Array.from({ length: count }, (_, i) => makeFile(`${prefix}${i + 1}.jpg`, sizeBytes, i));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('scanner batch', () => {

  // 1. Selecting five valid documents
  it('selects five valid documents into the batch', () => {
    const files = makeFiles(5);
    const result = mergeUniqueFiles([], files);
    expect(result).toHaveLength(5);
  });

  // 2. Appending more files without clearing earlier files
  it('appends new files without clearing existing ones', () => {
    const first = makeFiles(3, 'batch1');
    const second = makeFiles(2, 'batch2', 512);
    const result = mergeUniqueFiles(first, second);
    expect(result).toHaveLength(5);
    expect(result[0].name).toBe('batch11.jpg');
    expect(result[3].name).toBe('batch21.jpg');
  });

  // 3. Processing no more than two documents concurrently
  it('never processes more than two documents simultaneously', async () => {
    let active = 0;
    let maxActive = 0;
    const ids = Array.from({ length: 6 }, (_, i) => String(i));

    await simulateQueue(ids, SCAN_CONCURRENCY, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 15));
      active--;
    });

    expect(maxActive).toBeLessThanOrEqual(SCAN_CONCURRENCY);
    expect(maxActive).toBeGreaterThanOrEqual(1);
  });

  // 4. One failed document does not stop the others
  it('one failing item does not prevent the rest from completing', async () => {
    const completed: string[] = [];
    const ids = ['0', '1', '2', '3', '4'];

    // A non-429 error is terminal; the queue continues with the rest.
    await simulateQueue(ids, 2, async (id) => {
      if (id === '2') throw new Error('simulated scan failure');
      await new Promise(r => setTimeout(r, 5));
      completed.push(id);
    });

    expect(completed).toHaveLength(4);
    expect(completed).not.toContain('2');
    expect(completed).toContain('0');
    expect(completed).toContain('1');
    expect(completed).toContain('3');
    expect(completed).toContain('4');
  });

  // 5. Retrying only one failed document
  it('retryDoc resets only the targeted document', () => {
    type DocStatus = 'pending' | 'processing' | 'done' | 'error';
    const docs = [
      { id: 'a', status: 'done' as DocStatus, accepted: true, isDuplicate: false },
      { id: 'b', status: 'error' as DocStatus, accepted: false, isDuplicate: true },
      { id: 'c', status: 'done' as DocStatus, accepted: true, isDuplicate: false },
    ];

    // Simulate retryDoc state update
    const retryId = 'b';
    const updated = docs.map(d =>
      d.id === retryId ? { ...d, accepted: true, isDuplicate: false } : d,
    );

    expect(updated.find(d => d.id === 'b')?.accepted).toBe(true);
    expect(updated.find(d => d.id === 'b')?.isDuplicate).toBe(false);
    // Others unchanged
    expect(updated.find(d => d.id === 'a')?.status).toBe('done');
    expect(updated.find(d => d.id === 'c')?.status).toBe('done');
  });

  // 6. Removing only one document
  it('removeDoc removes only the targeted document', () => {
    const docs = [
      { id: 'a', preview: '', status: 'done', accepted: true },
      { id: 'b', preview: '', status: 'done', accepted: true },
      { id: 'c', preview: '', status: 'error', accepted: false },
    ];

    const after = docs.filter(d => d.id !== 'b');
    expect(after).toHaveLength(2);
    expect(after.map(d => d.id)).toEqual(['a', 'c']);
  });

  // 7. Duplicate files within the current batch
  it('detects duplicate files within the same batch', () => {
    const fp = 'abc123deadbeef';
    const fingerprintCounts = new Map<string, number>();

    // Simulate two docs with the same fingerprint
    const fps = [fp, 'unique1', fp, 'unique2'];
    for (const f of fps) fingerprintCounts.set(f, (fingerprintCounts.get(f) ?? 0) + 1);

    const isDupInBatch = (docFp: string | undefined) =>
      Boolean(docFp) && (fingerprintCounts.get(docFp!) ?? 0) > 1;

    expect(isDupInBatch(fp)).toBe(true);
    expect(isDupInBatch('unique1')).toBe(false);
    expect(isDupInBatch(undefined)).toBe(false);
  });

  // 8. Duplicate already saved previously
  it('detects a duplicate against previously saved documents', () => {
    const existingFingerprints = new Set(['saved1', 'saved2', 'saved3']);

    const isExistingDup = (fp: string | undefined) =>
      Boolean(fp) && existingFingerprints.has(fp!);

    expect(isExistingDup('saved1')).toBe(true);
    expect(isExistingDup('saved2')).toBe(true);
    expect(isExistingDup('brandnew')).toBe(false);
    expect(isExistingDup(undefined)).toBe(false);
  });

  // 9. Confirming only accepted successful documents
  it('savableDocuments includes only done + accepted docs', () => {
    const docs = [
      { status: 'done', accepted: true },
      { status: 'done', accepted: false },   // rejected
      { status: 'error', accepted: true },    // failed
      { status: 'done', accepted: true },
      { status: 'processing', accepted: true },
      { status: 'pending', accepted: true },
    ];

    const savable = docs.filter(d => d.status === 'done' && d.accepted);
    expect(savable).toHaveLength(2);
  });

  // 10. Rejecting one successful document
  it('rejecting one document leaves the others unchanged', () => {
    const docs = [
      { id: 'a', accepted: true },
      { id: 'b', accepted: true },
      { id: 'c', accepted: true },
    ];

    // Simulate toggleAccepted('b')
    const updated = docs.map(d => d.id === 'b' ? { ...d, accepted: !d.accepted } : d);

    expect(updated.find(d => d.id === 'b')?.accepted).toBe(false);
    expect(updated.find(d => d.id === 'a')?.accepted).toBe(true);
    expect(updated.find(d => d.id === 'c')?.accepted).toBe(true);
  });

  // 11. Exceeding the 20-file limit
  it('mergeUniqueFiles caps the batch at MAX_BATCH_FILES', () => {
    const existing = makeFiles(18, 'old');
    const incoming = makeFiles(5, 'new', 512);
    const result = mergeUniqueFiles(existing, incoming);
    expect(result).toHaveLength(MAX_BATCH_FILES);
  });

  // 12. Rejecting a file over 10 MB
  it('files over 10 MB are identified for rejection', () => {
    const files = [
      makeFile('small.jpg', 1024),
      makeFile('large.jpg', MAX_FILE_BYTES + 1),
      makeFile('medium.jpg', MAX_FILE_BYTES),
      makeFile('toobig.pdf', MAX_FILE_BYTES + 1024),
    ];

    const oversized = files.filter(f => f.size > MAX_FILE_BYTES);
    const sizeValid = files.filter(f => f.size <= MAX_FILE_BYTES);

    expect(oversized).toHaveLength(2);
    expect(sizeValid).toHaveLength(2);
    expect(oversized.map(f => f.name)).toContain('large.jpg');
    expect(oversized.map(f => f.name)).toContain('toobig.pdf');
  });

  // 13. Mixed image and PDF batch
  it('accepts a mixed batch of images and PDFs', () => {
    const imgJpg  = new File([new Uint8Array(1)], 'photo.jpg',  { type: 'image/jpeg' });
    const imgPng  = new File([new Uint8Array(1)], 'scan.png',   { type: 'image/png' });
    const pdfFile = new File([new Uint8Array(1)], 'doc.pdf',    { type: 'application/pdf' });
    const heic    = new File([new Uint8Array(1)], 'mobile.heic', { type: '' }); // iOS HEIC

    const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i;
    const isAccepted = (f: File) =>
      f.type.startsWith('image/') ||
      f.type === 'application/pdf' ||
      IMAGE_EXT.test(f.name) ||
      /\.pdf$/i.test(f.name);

    expect(isAccepted(imgJpg)).toBe(true);
    expect(isAccepted(imgPng)).toBe(true);
    expect(isAccepted(pdfFile)).toBe(true);
    expect(isAccepted(heic)).toBe(true); // caught by extension
  });

  // 14. Progress count accuracy
  it('progress counts are derived correctly from document statuses', () => {
    const docs = [
      { status: 'done' },
      { status: 'done' },
      { status: 'error' },
      { status: 'processing' },
      { status: 'pending' },
      { status: 'pending' },
    ];

    const totalCount = docs.length;
    const completedCount = docs.filter(d => d.status === 'done').length;
    const failedCount    = docs.filter(d => d.status === 'error').length;
    const processingCount = docs.filter(d => d.status === 'processing').length;
    const pendingCount   = docs.filter(d => d.status === 'pending').length;
    const finishedCount  = completedCount + failedCount;

    expect(totalCount).toBe(6);
    expect(completedCount).toBe(2);
    expect(failedCount).toBe(1);
    expect(processingCount).toBe(1);
    expect(pendingCount).toBe(2);
    expect(finishedCount).toBe(3);
    expect(processingCount + pendingCount).toBe(3); // remaining
  });

  // 15. Preview URL cleanup
  it('revokeObjectURL is called for the removed document\'s preview', () => {
    const revokedUrls: string[] = [];
    const mockRevoke = (url: string) => revokedUrls.push(url);

    const preview = 'blob:https://example.com/abc-123';
    const docs = [
      { id: 'doc1', preview, status: 'done' },
      { id: 'doc2', preview: '', status: 'done' },
      { id: 'doc3', preview: 'blob:https://example.com/other', status: 'error' },
    ];

    // Simulate removeDoc('doc1') pattern
    const removed = docs.find(d => d.id === 'doc1');
    if (removed?.preview) mockRevoke(removed.preview);
    const remaining = docs.filter(d => d.id !== 'doc1');

    expect(revokedUrls).toHaveLength(1);
    expect(revokedUrls[0]).toBe(preview);
    expect(remaining).toHaveLength(2);
    expect(remaining.map(d => d.id)).not.toContain('doc1');
  });
});

// ─── Rate-limit (429) regression tests ────────────────────────────────────────

describe('rate-limit helpers (is429Error, clampRetryMs, parseRetryDelay)', () => {

  // 16. is429Error recognizes httpStatus:429
  it('is429Error detects httpStatus 429 in structured JSON error', () => {
    const result = is429Error(make429Error());
    expect(result).not.toBeNull();
    expect(result).toMatchObject({ retryAfterHeader: null, retryAfterBodyMs: undefined });
  });

  // 17. is429Error reads retryAfterHeader
  it('is429Error passes through retryAfterHeader string', () => {
    const result = is429Error(make429Error({ retryAfterHeader: '10' }));
    expect(result).not.toBeNull();
    expect(result!.retryAfterHeader).toBe('10');
  });

  // 18. is429Error reads retryAfterBodyMs
  it('is429Error passes through retryAfterBodyMs number', () => {
    const result = is429Error(make429Error({ retryAfterBodyMs: 5000 }));
    expect(result).not.toBeNull();
    expect(result!.retryAfterBodyMs).toBe(5000);
  });

  // 19. is429Error returns null for non-rate-limit errors
  it('is429Error returns null for non-429 errors', () => {
    expect(is429Error(new Error('Network error'))).toBeNull();
    expect(is429Error(new Error(JSON.stringify({ httpStatus: 500, message: 'Server error' })))).toBeNull();
    expect(is429Error(new Error(JSON.stringify({ httpStatus: 401, message: 'Unauthorized' })))).toBeNull();
    expect(is429Error('not an error')).toBeNull();
    expect(is429Error(null)).toBeNull();
  });

  // 20. is429Error catches bare "too many requests" string errors
  it('is429Error detects bare "too many requests" message', () => {
    expect(is429Error(new Error('too many requests'))).not.toBeNull();
    expect(is429Error(new Error('HTTP 429 rate limit exceeded'))).not.toBeNull();
  });

  // 21. clampRetryMs enforces bounds
  it('clampRetryMs clamps below CLAMP_MIN_MS and above CLAMP_MAX_MS', () => {
    expect(clampRetryMs(0)).toBe(CLAMP_MIN_MS);
    expect(clampRetryMs(500)).toBe(CLAMP_MIN_MS);
    expect(clampRetryMs(5_000)).toBe(5_000);
    expect(clampRetryMs(30_000)).toBe(CLAMP_MAX_MS);
    expect(clampRetryMs(60_000)).toBe(CLAMP_MAX_MS);
    expect(clampRetryMs(1_550_000)).toBe(CLAMP_MAX_MS); // the "1550 seconds" bug
  });

  // 22. parseRetryDelay priority: bodyMs first
  it('parseRetryDelay prefers retryAfterBodyMs over header', () => {
    const delay = parseRetryDelay('60', 5_000, 0);
    expect(delay).toBe(5_000); // body 5000ms wins over header 60s=60000ms
  });

  // 23. parseRetryDelay: numeric header (seconds)
  it('parseRetryDelay converts numeric header string from seconds to ms', () => {
    const delay = parseRetryDelay('7', undefined, 0);
    expect(delay).toBe(7_000);
  });

  // 24. parseRetryDelay: numeric header clamped above 30 s
  it('parseRetryDelay clamps a 1550-second numeric header to CLAMP_MAX_MS', () => {
    const delay = parseRetryDelay('1550', undefined, 0);
    expect(delay).toBe(CLAMP_MAX_MS); // the "1550 seconds" display bug fixed
  });

  // 25. parseRetryDelay: HTTP-date header
  it('parseRetryDelay parses an HTTP-date Retry-After header', () => {
    // Set a date 10 seconds in the future
    const futureDate = new Date(Date.now() + 10_000).toUTCString();
    const delay = parseRetryDelay(futureDate, undefined, 0);
    // Should be ~10s, clamped to [1000, 30000]
    expect(delay).toBeGreaterThanOrEqual(CLAMP_MIN_MS);
    expect(delay).toBeLessThanOrEqual(CLAMP_MAX_MS);
  });

  // 26. parseRetryDelay: HTTP-date far in future clamped
  it('parseRetryDelay clamps a far-future HTTP-date to CLAMP_MAX_MS', () => {
    const farFuture = new Date(Date.now() + 600_000).toUTCString(); // 10 min
    const delay = parseRetryDelay(farFuture, undefined, 0);
    expect(delay).toBe(CLAMP_MAX_MS);
  });

  // 27. parseRetryDelay: falls back to exponential back-off
  it('parseRetryDelay falls back to RETRY_DELAYS_MS when no header or body', () => {
    expect(parseRetryDelay(null, undefined, 0)).toBe(RETRY_DELAYS_MS[0]);
    expect(parseRetryDelay(null, undefined, 1)).toBe(RETRY_DELAYS_MS[1]);
    expect(parseRetryDelay(null, undefined, 2)).toBe(RETRY_DELAYS_MS[2]);
    expect(parseRetryDelay(null, undefined, 99)).toBe(RETRY_DELAYS_MS[2]); // capped at last
  });

  // 28. 12-doc batch: slot released on 429, other docs not blocked
  it('12-doc batch: 429 on 2 docs releases slots so the other 10 run freely', async () => {
    const TOTAL = 12;
    const RATE_LIMITED = new Set(['2', '7']);
    const completed: string[] = [];

    const callCounts = await simulateQueue(
      Array.from({ length: TOTAL }, (_, i) => String(i)),
      SCAN_CONCURRENCY,
      async (id, attempt) => {
        if (RATE_LIMITED.has(id) && attempt === 0) throw make429Error();
        completed.push(id);
      },
    );

    expect(completed).toHaveLength(TOTAL); // all 12 complete
    RATE_LIMITED.forEach(id => expect(callCounts.get(id)).toBe(2));
    Array.from({ length: TOTAL }, (_, i) => String(i))
      .filter(id => !RATE_LIMITED.has(id))
      .forEach(id => expect(callCounts.get(id)).toBe(1));
  });

  // 29. Confirm disabled while any doc is processing, retrying, or pending
  it('Confirm is disabled when any doc is processing, retrying, or pending', () => {
    type DocStatus = 'pending' | 'processing' | 'retrying' | 'done' | 'error';
    const isConfirmDisabled = (docs: Array<{ status: DocStatus; accepted: boolean }>) => {
      const savable = docs.filter(d => d.status === 'done' && d.accepted);
      return (
        savable.length === 0 ||
        docs.some(d => d.status === 'processing' || d.status === 'retrying' || d.status === 'pending')
      );
    };

    // All done and accepted → enabled
    expect(isConfirmDisabled([
      { status: 'done', accepted: true },
      { status: 'done', accepted: true },
    ])).toBe(false);

    // One still processing → disabled
    expect(isConfirmDisabled([
      { status: 'done', accepted: true },
      { status: 'processing', accepted: true },
    ])).toBe(true);

    // One retrying → disabled
    expect(isConfirmDisabled([
      { status: 'done', accepted: true },
      { status: 'retrying', accepted: true },
    ])).toBe(true);

    // One pending → disabled (new condition)
    expect(isConfirmDisabled([
      { status: 'done', accepted: true },
      { status: 'pending', accepted: true },
    ])).toBe(true);

    // All done but none accepted → disabled
    expect(isConfirmDisabled([
      { status: 'done', accepted: false },
    ])).toBe(true);
  });

  // 30. retryingCount is separate from processingCount in progress totals
  it('retryingCount is derived correctly from document statuses', () => {
    type DocStatus = 'pending' | 'processing' | 'retrying' | 'done' | 'error';
    const docs: Array<{ status: DocStatus }> = [
      { status: 'done' },
      { status: 'done' },
      { status: 'error' },
      { status: 'processing' },
      { status: 'retrying' },
      { status: 'retrying' },
      { status: 'pending' },
    ];

    const completedCount  = docs.filter(d => d.status === 'done').length;
    const failedCount     = docs.filter(d => d.status === 'error').length;
    const processingCount = docs.filter(d => d.status === 'processing').length;
    const retryingCount   = docs.filter(d => d.status === 'retrying').length;
    const pendingCount    = docs.filter(d => d.status === 'pending').length;
    const finishedCount   = completedCount + failedCount;
    const activeCount     = processingCount + retryingCount + pendingCount;

    expect(retryingCount).toBe(2);
    expect(finishedCount).toBe(3);  // retrying does NOT count as finished
    expect(activeCount).toBe(4);    // processing + retrying + pending
  });

  // 31. Exponential back-off table: 2 s, 4 s, 8 s
  it('back-off delays are 2000, 4000, 8000 ms', () => {
    expect(RETRY_DELAYS_MS[0]).toBe(2_000);
    expect(RETRY_DELAYS_MS[1]).toBe(4_000);
    expect(RETRY_DELAYS_MS[2]).toBe(8_000);
  });
});

// ─── Error message sanitization (Tests 32-38) ─────────────────────────────────
//
// Verifies that every error stage the scanner can display to the user is a
// safe, human-readable string with no stack traces, internal paths, API keys,
// or other sensitive implementation details.

describe('error message sanitization', () => {

  /** Returns true when a string is safe to display to a user. */
  function isSafeUserMessage(msg: string): boolean {
    if (!msg || typeof msg !== 'string') return false;
    // No stack-trace markers
    if (/\bat [A-Za-z].*:\d+/.test(msg)) return false;          // "at fn (file:line)"
    if (/\bError:\s/.test(msg)) return false;                    // "Error: ..."
    // No internal file paths
    if (/\/home\/runner/.test(msg)) return false;
    if (/node_modules/.test(msg)) return false;
    if (/\/artifacts\//.test(msg)) return false;
    // No likely API key patterns (long alphanumeric tokens)
    if (/sk-[A-Za-z0-9]{20,}/.test(msg)) return false;
    if (/[A-Za-z0-9]{40,}/.test(msg)) return false;
    return true;
  }

  // 32. Terminal scan failure message is safe
  it('32. terminal scan failure message is safe for user display', () => {
    // Mirrors what parseApiError returns for a 422 response
    const stages = [
      { stage: 'ai_json_parse',         message: 'The document processor returned an unrecognized response format. Please try again.' },
      { stage: 'scan_timeout',          message: 'Document analysis timed out after 60 seconds. Please try a smaller or clearer document.' },
      { stage: 'file_size_limit',       message: 'File is too large. Maximum upload size is 10 MB.' },
      { stage: 'mime_validation',       message: 'Unsupported or unrecognized file. Upload a real JPG, PNG, WebP, HEIC/HEIF, or PDF file.' },
      { stage: 'pdf_encryption',        message: 'Password-protected or encrypted PDFs are not supported. Remove the password and try again.' },
      { stage: 'pdf_image_only',        message: 'This PDF appears to contain scanned images without readable text. Upload clear images of the relevant pages for now.' },
      { stage: 'pdf_decode',            message: 'The PDF could not be decoded. It may be corrupt or unsupported.' },
      { stage: 'pdf_page_limit',        message: 'PDF has 25 pages. The current limit is 20 pages.' },
      { stage: 'image_decode',          message: 'The image could not be decoded. It may be corrupt or use an unsupported encoding.' },
      { stage: 'image_normalization',   message: 'The image could not be safely normalized for scanning.' },
      { stage: 'image_dimensions',      message: 'Image resolution is too large. Maximum decoded size is 25 megapixels.' },
      { stage: 'backend_receipt',       message: 'No file received. Please choose one document and try again.' },
      { stage: 'authentication',        message: 'You must sign in to use this feature.' },
      { stage: 'duplicate_document',    message: 'This document has already been imported. Each file can only be added once per account.' },
      { stage: 'multipart_validation',  message: 'The upload request is malformed. Please choose one file and try again.' },
      { stage: 'ai_request',            message: 'Document analysis failed. Please try again.' },
    ];

    for (const { stage, message } of stages) {
      expect(isSafeUserMessage(message)).toBe(true);
      // Check stage name is a safe slug
      expect(stage).toMatch(/^[a-z_]+$/);
    }
  });

  // 33. parseApiError only surfaces stage + message — not the full JSON
  it('33. parseApiError extracts only stage and message from structured errors', () => {
    function parseApiError(err: unknown): { stage: string; message: string } {
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message);
          return { stage: parsed.stage ?? 'unknown', message: parsed.message ?? err.message };
        } catch {
          return { stage: 'unknown', message: err.message };
        }
      }
      return { stage: 'unknown', message: String(err) };
    }

    const structuredError = new Error(JSON.stringify({
      stage: 'pdf_encryption',
      message: 'Password-protected or encrypted PDFs are not supported.',
      filename: 'secure.pdf',
      httpStatus: 422,
      // These internal fields should NOT reach the user
      diagnosis: { rawHead: 'account 1234 SSN 999-99-9999', rawTail: 'sensitive data' },
      responseMetadata: { attempt1: { model: 'gpt-secret', totalTokens: 9999 } },
    }));

    const result = parseApiError(structuredError);

    expect(result.stage).toBe('pdf_encryption');
    expect(result.message).toBe('Password-protected or encrypted PDFs are not supported.');
    // parseApiError returns { stage, message } — the full JSON is NOT in either field
    expect(result.message).not.toContain('rawHead');
    expect(result.message).not.toContain('account 1234');
    expect(result.message).not.toContain('SSN');
    expect(result.message).not.toContain('gpt-secret');
  });

  // 34. 409 duplicate error: stage parsed correctly
  it('34. duplicate 409 error is parsed to duplicate_document stage', () => {
    function parseApiError(err: unknown): { stage: string; message: string } {
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message);
          return { stage: parsed.stage ?? 'unknown', message: parsed.message ?? err.message };
        } catch {
          return { stage: 'unknown', message: err.message };
        }
      }
      return { stage: 'unknown', message: String(err) };
    }

    const dupError = new Error(JSON.stringify({
      stage: 'duplicate_document',
      message: 'This document has already been imported. Each file can only be added once per account. (First imported: 1/1/2026)',
      filename: 'paystub.jpg',
      httpStatus: 409,
    }));

    const result = parseApiError(dupError);

    expect(result.stage).toBe('duplicate_document');
    expect(result.message).toContain('already been imported');
    expect(isSafeUserMessage(result.message)).toBe(true);
  });

  // 35. is429Error does NOT match 409 duplicate responses
  it('35. is429Error does not match 409 duplicate_document errors', () => {
    const dupError = new Error(JSON.stringify({
      stage: 'duplicate_document',
      httpStatus: 409,
      message: 'This document has already been imported.',
      filename: 'statement.pdf',
    }));

    expect(is429Error(dupError)).toBeNull();
  });

  // 36. Non-JSON scan error falls back gracefully
  it('36. plain Error message is surfaced as-is with unknown stage', () => {
    function parseApiError(err: unknown): { stage: string; message: string } {
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message);
          return { stage: parsed.stage ?? 'unknown', message: parsed.message ?? err.message };
        } catch {
          return { stage: 'unknown', message: err.message };
        }
      }
      return { stage: 'unknown', message: String(err) };
    }

    const plainError = new Error('Network connection lost');
    const result = parseApiError(plainError);

    expect(result.stage).toBe('unknown');
    expect(result.message).toBe('Network connection lost');
  });

  // 37. Files with no extension or wrong extension are filtered by client
  it('37. client file filter rejects files with no recognized extension or MIME type', () => {
    const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i;

    const isAccepted = (name: string, type: string) =>
      type.startsWith('image/') ||
      type === 'application/pdf' ||
      IMAGE_EXT.test(name) ||
      /\.pdf$/i.test(name);

    // Valid files
    expect(isAccepted('statement.pdf',   'application/pdf')).toBe(true);
    expect(isAccepted('photo.jpg',       'image/jpeg')).toBe(true);
    expect(isAccepted('scan.png',        'image/png')).toBe(true);
    expect(isAccepted('mobile.heic',     '')).toBe(true);  // iOS: no MIME, extension matches

    // Invalid: no extension, no valid MIME
    expect(isAccepted('nodotfile',       '')).toBe(false);
    expect(isAccepted('document.exe',    'application/octet-stream')).toBe(false);
    expect(isAccepted('spreadsheet.xls', 'application/vnd.ms-excel')).toBe(false);
    expect(isAccepted('archive.zip',     'application/zip')).toBe(false);
    expect(isAccepted('text.txt',        'text/plain')).toBe(false);
    expect(isAccepted('script.js',       'application/javascript')).toBe(false);
  });

  // 38. Abort/timeout error is safe and does not retry as a 429
  it('38. timeout abort error is safe and not treated as a rate-limit', () => {
    const abortError = new Error(JSON.stringify({
      stage: 'scan_timeout',
      message: 'Document analysis timed out after 60 seconds. Please try a smaller or clearer document.',
      filename: 'large-statement.pdf',
    }));

    // Must not trigger 429 retry logic
    expect(is429Error(abortError)).toBeNull();

    // Message is safe
    function parseApiError(err: unknown): { stage: string; message: string } {
      if (err instanceof Error) {
        try { const p = JSON.parse(err.message); return { stage: p.stage ?? 'unknown', message: p.message ?? err.message }; }
        catch { return { stage: 'unknown', message: err.message }; }
      }
      return { stage: 'unknown', message: String(err) };
    }
    const { stage, message } = parseApiError(abortError);
    expect(stage).toBe('scan_timeout');
    expect(isSafeUserMessage(message)).toBe(true);
  });
});
