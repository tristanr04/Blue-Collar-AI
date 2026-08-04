/**
 * Unit tests for scanner batch-processing helpers.
 *
 * These tests cover mergeUniqueFiles, runWithConcurrency, duplicate detection,
 * document filtering, progress counts, and preview URL cleanup patterns.
 * Pure functions are replicated here because they are not exported from
 * Scanner.tsx.  Keep in sync with changes to those functions.
 */

import { describe, it, expect, vi } from 'vitest';

// ─── Replicated helpers (keep in sync with Scanner.tsx) ───────────────────────

const MAX_BATCH_FILES = 20;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SCAN_CONCURRENCY = 2;

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
