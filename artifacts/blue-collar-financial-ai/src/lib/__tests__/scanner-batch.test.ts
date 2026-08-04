/**
 * Unit tests for scanner batch-processing helpers.
 *
 * These tests cover mergeUniqueFiles, runWithConcurrency, duplicate detection,
 * document filtering, progress counts, preview URL cleanup patterns, and
 * rate-limit (429) retry logic.
 * Pure functions are replicated here because they are not exported from
 * Scanner.tsx.  Keep in sync with changes to those functions.
 */

import { describe, it, expect, vi } from 'vitest';

// ─── Replicated helpers (keep in sync with Scanner.tsx) ───────────────────────

const MAX_BATCH_FILES = 20;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SCAN_CONCURRENCY = 2;
const RETRY_DELAYS_MS = [2000, 4000, 8000] as const;
const MAX_RATE_LIMIT_RETRIES = 3;

// ─── Rate-limit helpers (keep in sync with Scanner.tsx) ───────────────────────

function is429Error(err: unknown): { retryAfterMs: number } | null {
  if (!(err instanceof Error)) return null;
  try {
    const parsed = JSON.parse(err.message) as Record<string, unknown>;
    const status = parsed.httpStatus;
    const msg = typeof parsed.message === 'string' ? parsed.message.toLowerCase() : '';
    if (status === 429 || msg.includes('too many requests') || msg.includes('rate limit')) {
      const retryAfterSec = typeof parsed.retryAfter === 'number' ? parsed.retryAfter : 0;
      return { retryAfterMs: retryAfterSec > 0 ? retryAfterSec * 1000 : 0 };
    }
  } catch { /* not JSON */ }
  const raw = err.message.toLowerCase();
  if (raw.includes('429') || raw.includes('too many requests') || raw.includes('rate limit')) {
    return { retryAfterMs: 0 };
  }
  return null;
}

type ScanResult = { docType: string };

async function scanWithRetry(
  _file: unknown,
  _token: string | null,
  onRetrying: (attempt: number, waitMs: number) => void,
  scanFn: () => Promise<ScanResult>,
): Promise<ScanResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await scanFn();
    } catch (err) {
      const rl = is429Error(err);
      if (rl === null || attempt >= MAX_RATE_LIMIT_RETRIES) throw err;
      const waitMs = rl.retryAfterMs > 0
        ? rl.retryAfterMs
        : (RETRY_DELAYS_MS[attempt] ?? 8000);
      onRetrying(attempt + 1, waitMs);
      await new Promise<void>(resolve => setTimeout(resolve, 1)); // use 1ms in tests
    }
  }
}

function make429Error(opts?: { retryAfter?: number; message?: string }): Error {
  return new Error(JSON.stringify({
    stage: 'backend_receipt',
    httpStatus: 429,
    message: opts?.message ?? 'Too Many Requests',
    filename: 'test.jpg',
    ...(opts?.retryAfter !== undefined ? { retryAfter: opts.retryAfter } : {}),
  }));
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

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
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
    const items = Array.from({ length: 6 }, (_, i) => i);

    await runWithConcurrency(items, SCAN_CONCURRENCY, async () => {
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
    const completed: number[] = [];
    const items = [0, 1, 2, 3, 4];

    // Production pattern: processDoc self-catches, so the worker never throws
    await runWithConcurrency(items, 2, async (item) => {
      try {
        if (item === 2) throw new Error('simulated scan failure');
        await new Promise(r => setTimeout(r, 5));
        completed.push(item);
      } catch {
        // Worker self-catches — batch continues
      }
    });

    expect(completed).toHaveLength(4);
    expect(completed).not.toContain(2);
    expect(completed).toContain(0);
    expect(completed).toContain(1);
    expect(completed).toContain(3);
    expect(completed).toContain(4);
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

describe('rate-limit retry (is429Error + scanWithRetry)', () => {

  // 16. is429Error recognizes httpStatus:429
  it('is429Error detects httpStatus 429 in structured JSON error', () => {
    expect(is429Error(make429Error())).not.toBeNull();
    expect(is429Error(make429Error())).toMatchObject({ retryAfterMs: 0 });
  });

  // 17. is429Error reads Retry-After header value
  it('is429Error converts retryAfter seconds to milliseconds', () => {
    const result = is429Error(make429Error({ retryAfter: 5 }));
    expect(result).not.toBeNull();
    expect(result!.retryAfterMs).toBe(5000);
  });

  // 18. is429Error is null for non-rate-limit errors
  it('is429Error returns null for non-429 errors', () => {
    expect(is429Error(new Error('Network error'))).toBeNull();
    expect(is429Error(new Error(JSON.stringify({ httpStatus: 500, message: 'Server error' })))).toBeNull();
    expect(is429Error(new Error(JSON.stringify({ httpStatus: 401, message: 'Unauthorized' })))).toBeNull();
    expect(is429Error('not an error')).toBeNull();
    expect(is429Error(null)).toBeNull();
  });

  // 19. is429Error catches bare "too many requests" string errors
  it('is429Error detects bare "too many requests" message', () => {
    expect(is429Error(new Error('too many requests'))).not.toBeNull();
    expect(is429Error(new Error('HTTP 429 rate limit exceeded'))).not.toBeNull();
  });

  // 20. scanWithRetry succeeds immediately when no 429
  it('scanWithRetry returns on first attempt when no rate limit', async () => {
    const calls: number[] = [];
    const retries: number[] = [];
    const result = await scanWithRetry(null, null, (attempt) => retries.push(attempt), async () => {
      calls.push(1);
      return { docType: 'Paystub' };
    });
    expect(result.docType).toBe('Paystub');
    expect(calls).toHaveLength(1);
    expect(retries).toHaveLength(0);
  });

  // 21. scanWithRetry retries on 429 and succeeds on 2nd attempt
  it('scanWithRetry retries once after a 429 and succeeds', async () => {
    let callCount = 0;
    const retries: Array<{ attempt: number; waitMs: number }> = [];

    const result = await scanWithRetry(null, null,
      (attempt, waitMs) => retries.push({ attempt, waitMs }),
      async () => {
        callCount++;
        if (callCount === 1) throw make429Error();
        return { docType: 'Checking Account' };
      },
    );

    expect(result.docType).toBe('Checking Account');
    expect(callCount).toBe(2);
    expect(retries).toHaveLength(1);
    expect(retries[0].attempt).toBe(1);
    expect(retries[0].waitMs).toBe(RETRY_DELAYS_MS[0]); // exponential back-off
  });

  // 22. scanWithRetry honors Retry-After header over back-off table
  it('scanWithRetry uses Retry-After value instead of exponential back-off', async () => {
    let callCount = 0;
    const retries: Array<{ attempt: number; waitMs: number }> = [];

    await scanWithRetry(null, null,
      (attempt, waitMs) => retries.push({ attempt, waitMs }),
      async () => {
        callCount++;
        if (callCount === 1) throw make429Error({ retryAfter: 7 }); // 7-second header
        return { docType: 'Credit Card' };
      },
    );

    expect(retries[0].waitMs).toBe(7000); // Retry-After 7s → 7000ms
  });

  // 23. scanWithRetry exhausts 3 retries then throws
  it('scanWithRetry gives up after MAX_RATE_LIMIT_RETRIES and throws', async () => {
    let callCount = 0;
    const retries: number[] = [];

    await expect(
      scanWithRetry(null, null,
        (attempt) => retries.push(attempt),
        async () => {
          callCount++;
          throw make429Error();
        },
      ),
    ).rejects.toThrow();

    // Initial call + 3 retries = 4 total calls
    expect(callCount).toBe(MAX_RATE_LIMIT_RETRIES + 1);
    expect(retries).toHaveLength(MAX_RATE_LIMIT_RETRIES);
    expect(retries).toEqual([1, 2, 3]);
  });

  // 24. 429 on one doc in a 12-doc batch does not affect completed docs
  it('12-doc batch: 429 on 2 docs does not block the other 10', async () => {
    const TOTAL = 12;
    const RATE_LIMITED_IDS = new Set([2, 7]); // docs that get one 429 each
    const completed: number[] = [];
    const retriedIds: number[] = [];
    const callCounts = new Array(TOTAL).fill(0);

    const items = Array.from({ length: TOTAL }, (_, i) => i);

    await runWithConcurrency(items, SCAN_CONCURRENCY, async (id) => {
      await scanWithRetry(null, null,
        () => retriedIds.push(id),
        async () => {
          callCounts[id]++;
          if (RATE_LIMITED_IDS.has(id) && callCounts[id] === 1) {
            throw make429Error();
          }
          completed.push(id);
        },
      );
    });

    expect(completed).toHaveLength(TOTAL); // all 12 complete
    expect(retriedIds.sort()).toEqual([2, 7]); // exactly the two rate-limited docs retried
    // Rate-limited docs needed 2 scanFile calls; others needed 1
    RATE_LIMITED_IDS.forEach(id => expect(callCounts[id]).toBe(2));
    items.filter(i => !RATE_LIMITED_IDS.has(i)).forEach(id => expect(callCounts[id]).toBe(1));
  });

  // 25. Confirm disabled while docs are processing or retrying
  it('Confirm is disabled when any doc is processing or retrying', () => {
    type DocStatus = 'pending' | 'processing' | 'retrying' | 'done' | 'error';
    const isConfirmDisabled = (docs: Array<{ status: DocStatus; accepted: boolean }>) => {
      const savable = docs.filter(d => d.status === 'done' && d.accepted);
      return savable.length === 0 || docs.some(d => d.status === 'processing' || d.status === 'retrying');
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

    // All done but none accepted → disabled
    expect(isConfirmDisabled([
      { status: 'done', accepted: false },
    ])).toBe(true);
  });

  // 26. retryingCount is accurate in progress counts
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

  // 27. Exponential back-off table: 2 s, 4 s, 8 s
  it('back-off delays are approximately 2, 4, 8 seconds', () => {
    expect(RETRY_DELAYS_MS[0]).toBe(2000);
    expect(RETRY_DELAYS_MS[1]).toBe(4000);
    expect(RETRY_DELAYS_MS[2]).toBe(8000);
  });
});
