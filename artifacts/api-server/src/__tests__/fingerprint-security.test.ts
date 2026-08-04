/**
 * Tests for server-side fingerprint security (Priority 2).
 *
 * Covers:
 *  - computeFileFingerprint: deterministic, 64-char hex, distinct for different content
 *  - checkDocumentFingerprint: returns existing record on duplicate, null otherwise
 *  - createScannedDocument: succeeds on first upload; silent no-op on duplicate
 *  - Cross-user isolation: same fingerprint is allowed for different users
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  checkDocumentFingerprint,
  createScannedDocument,
  ensureUser,
} from "../lib/financial-repository.js";
import { computeFileFingerprint } from "../lib/fingerprint.js";

const USER_A = `test_fp_a_${Date.now()}`;
const USER_B = `test_fp_b_${Date.now()}`;

before(async () => {
  await ensureUser({ userId: USER_A });
  await ensureUser({ userId: USER_B });
});

after(async () => {
  await db.delete(usersTable).where(eq(usersTable.id, USER_A));
  await db.delete(usersTable).where(eq(usersTable.id, USER_B));
});

// ─── Pure fingerprint function ────────────────────────────────────────────────

test("computeFileFingerprint returns 64-char lowercase hex", () => {
  const fp = computeFileFingerprint(Buffer.from("hello world"));
  assert.match(fp, /^[0-9a-f]{64}$/, "output is 64-char lowercase hex (SHA-256)");
});

test("computeFileFingerprint is deterministic: same input → same output", () => {
  const content = Buffer.from("test document content");
  const fp1 = computeFileFingerprint(content);
  const fp2 = computeFileFingerprint(content);
  assert.equal(fp1, fp2, "identical content always produces the same fingerprint");
});

test("computeFileFingerprint: different content → different fingerprints", () => {
  const fp1 = computeFileFingerprint(Buffer.from("document A - unique content"));
  const fp2 = computeFileFingerprint(Buffer.from("document B - different content"));
  assert.notEqual(fp1, fp2, "different content produces different fingerprints");
});

test("computeFileFingerprint: one-byte change changes fingerprint", () => {
  const buf1 = Buffer.from([0x01, 0x02, 0x03]);
  const buf2 = Buffer.from([0x01, 0x02, 0x04]); // last byte differs
  assert.notEqual(
    computeFileFingerprint(buf1),
    computeFileFingerprint(buf2),
    "single-byte change alters the fingerprint",
  );
});

// ─── checkDocumentFingerprint ─────────────────────────────────────────────────

test("checkDocumentFingerprint returns null when fingerprint is unknown", async () => {
  const fp = computeFileFingerprint(Buffer.from(`unknown_${Date.now()}`));
  const result = await checkDocumentFingerprint(USER_A, fp);
  assert.equal(result, undefined, "unknown fingerprint returns undefined (not found)");
});

// ─── createScannedDocument + duplicate rejection ──────────────────────────────

test("createScannedDocument: first upload succeeds and returns a record", async () => {
  const content = Buffer.from(`first_upload_test_${Date.now()}`);
  const fp = computeFileFingerprint(content);

  const created = await createScannedDocument(USER_A, {
    fileFingerprint: fp,
    fileName: "statement.jpg",
    mimeType: "image/jpeg",
    documentType: "Bank Statement",
    status: "Processed",
  });

  assert.ok(created, "first upload returns a created record");
  assert.equal(created!.fileFingerprint, fp);
  assert.equal(created!.fileName, "statement.jpg");
});

test("createScannedDocument: duplicate fingerprint is silently rejected (ON CONFLICT DO NOTHING)", async () => {
  const content = Buffer.from(`duplicate_test_${Date.now()}`);
  const fp = computeFileFingerprint(content);

  // First upload.
  const first = await createScannedDocument(USER_A, {
    fileFingerprint: fp,
    fileName: "paystub.jpg",
    mimeType: "image/jpeg",
    documentType: "Paystub",
    status: "Processed",
  });
  assert.ok(first, "first upload succeeds");

  // Second upload with same fingerprint — must be silently dropped.
  const duplicate = await createScannedDocument(USER_A, {
    fileFingerprint: fp,
    fileName: "paystub-copy.jpg", // different name, same fingerprint
    mimeType: "image/jpeg",
    documentType: "Paystub",
    status: "Processed",
  });
  assert.equal(duplicate, undefined, "duplicate fingerprint → undefined (no new row)");

  // checkDocumentFingerprint must surface the ORIGINAL record.
  const existing = await checkDocumentFingerprint(USER_A, fp);
  assert.ok(existing, "duplicate check finds the existing record");
  assert.equal(existing!.fileName, "paystub.jpg", "original filename is preserved");
});

test("duplicate fingerprint is user-scoped: a different user can upload the same file", async () => {
  const content = Buffer.from(`cross_user_test_${Date.now()}`);
  const fp = computeFileFingerprint(content);

  // USER_A uploads.
  const docA = await createScannedDocument(USER_A, {
    fileFingerprint: fp,
    fileName: "shared-doc.jpg",
    mimeType: "image/jpeg",
    documentType: "Unknown",
    status: "Processed",
  });
  assert.ok(docA, "USER_A upload succeeds");

  // USER_B uploads the exact same file — must be allowed.
  const docB = await createScannedDocument(USER_B, {
    fileFingerprint: fp,
    fileName: "shared-doc.jpg",
    mimeType: "image/jpeg",
    documentType: "Unknown",
    status: "Processed",
  });
  assert.ok(docB, "USER_B can upload the same file (different user scope)");
  assert.notEqual(docA!.id, docB!.id, "each user gets their own document record");
});
