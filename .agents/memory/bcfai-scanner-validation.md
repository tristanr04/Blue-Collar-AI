---
name: BCFAI Scanner E2E Validation
description: Security fix and test additions from batch scanner end-to-end validation pass.
---

# BCFAI Scanner E2E Validation Results

## Security Fix — rawHead/rawTail removed from 422 responses

`buildDiagnosticFailureBody` in `artifacts/api-server/src/routes/scan.ts` previously included `rawHead` (600 chars) and `rawTail` (300 chars) of raw AI model output in the HTTP 422 response body. The AI may echo back document content (account numbers, names, balances) before failing JSON validation, making these fields a PII leak to browser devtools.

**Fix:** Both fields removed from the response object. They remain in server-side `logger.warn` calls.

**Why:** Diagnostic data for developers lives in structured server logs; the HTTP body goes to the client and is visible in browser network tab.

**How to apply:** Any new diagnostic response body in scan.ts must never include raw AI text. Metadata (token counts, finish_reason, cause enum) is fine.

## checkCapabilities auth fix

`checkCapabilities()` in `api.ts` never passed an auth token — the endpoint requires Clerk auth and returned 401, making the function always return `{ ai: false }`. Fixed by adding optional `token?` parameter.

## Remaining risk — localStorage not user-scoped

Financial data in the Pinia/React store is saved to localStorage without a userId namespace. If User A and User B share a browser, User B will see User A's scanned financial data. Server-side data (fingerprints, scanned document records) IS user-scoped. Client-side store is not. This is an architectural limitation, not a code bug.

## Test files added/updated

- `artifacts/api-server/src/__tests__/scan-route-validation.test.ts` — NEW (14 tests)
  - isEncryptedPdfError detection (password/encrypted/non-encryption errors)
  - buildDiagnosticFailureBody response body never contains rawHead/rawTail (security regression)
  - Safe diagnostic fields ARE present in 422 body
  - Error message sanitization (no stack traces, internal paths, API keys)
  - Upload security: MIME spoofing, ELF executable, zero-byte file
  - 409 duplicate response shape, pdf_encryption/pdf_image_only message shape

- `artifacts/blue-collar-financial-ai/src/lib/__tests__/scanner-batch.test.ts` — UPDATED (+7 tests, now 38 total)
  - Error message sanitization across all stages
  - parseApiError extracts only stage+message, never internal diagnosis fields
  - 409 duplicate stage detection
  - is429Error does NOT match 409
  - Non-JSON error fallback
  - Client file filter (no-extension, wrong-extension files rejected)
  - Timeout abort error is safe and not treated as rate-limit
