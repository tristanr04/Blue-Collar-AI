/**
 * Server-side SHA-256 fingerprint utility.
 *
 * The hex output is byte-for-byte identical to the client-side
 * `fingerprintFile()` in src/lib/account-matching.ts, which uses
 * Web Crypto's `crypto.subtle.digest('SHA-256', ...)`.
 * Both are standard SHA-256: same input always produces the same 64-char hex
 * regardless of environment.
 */
import { createHash } from "node:crypto";

/**
 * Compute a deterministic SHA-256 hex fingerprint for a file buffer.
 * Used for server-side duplicate-document detection.
 */
export function computeFileFingerprint(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
