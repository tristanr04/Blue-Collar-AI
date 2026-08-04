---
name: BCFAI Architecture
description: Frontend-only localStorage app + API server for AI scan/chat; key routing and integration details.
---

## Stack
- Frontend: React + Vite (`artifacts/blue-collar-financial-ai`)
- Backend: Express (`artifacts/api-server`)
- Auth: Clerk (VITE_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY)
- Storage: localStorage only (no database)

## Key routing
- Frontend served at `/blue-collar-financial-ai` (preview path)
- API server at `/api-server` (preview path)
- Scanner page: `/scanner` inside the frontend

## Scanner batch architecture (added)
- `BatchDocument` replaces old `ProcessedDoc` — `isDuplicate` is now required (not optional)
- `BatchDocumentStatus` replaces `ProcessStatus`  
- Module-level pure helpers: `mergeUniqueFiles`, `runWithConcurrency`, `normalizeScanResult`, `getFieldValue`, `parseApiError`
- Constants: `MAX_BATCH_FILES=20`, `MAX_FILE_BYTES=10MB`, `SCAN_CONCURRENCY=2`
- `runWithConcurrency` runs SCAN_CONCURRENCY slots simultaneously; processDoc self-catches so one failure doesn't abort the batch
- `savableDocuments = docs.filter(d => d.status==='done' && d.accepted)` is the source of truth for confirmAndSave and the review footer
- Preview URL lifecycle: upload-step previews revoked at startProcessing start; doc previews revoked in removeDoc; all revoked on unmount via refs

## AI response parsing
- `extractFromImage`/`extractFromText` return full response object (not just content)
- `getModelOutput()` tries `output_text → choices[0].message.content → content[0].text → …`
- Vehicle loan and bank statement bypass Zod validation (fast paths in scan.ts)

## Test commands
- Frontend: `cd artifacts/blue-collar-financial-ai && pnpm vitest run`
- API: `cd artifacts/api-server && pnpm test`  (needs `--import tsx/esm` flag — use `pnpm test` not bare `node --test`)
- API typecheck: `cd artifacts/api-server && pnpm typecheck`
- Frontend typecheck: `cd artifacts/blue-collar-financial-ai && pnpm tsc --noEmit`

## drizzle-zod
- Do NOT use drizzle-zod@0.8.3 with Zod v3 — use plain `z.object()` instead

## Rate-limit retry (added)
- `is429Error(err)` — detects HTTP 429 / "too many requests" from the structured JSON error thrown by `scanFile`; returns `{ retryAfterMs }` (0 = use back-off table) or null
- `scanWithRetry(file, token, onRetrying)` — wraps `scanFile` with up to 3 retries on 429; honors `Retry-After` header (ms = seconds × 1000); otherwise uses RETRY_DELAYS_MS [2000, 4000, 8000]
- `processDoc` calls `scanWithRetry`; `onRetrying` callback sets doc status to `'retrying'` with `retryAttempt` + `retryWaitMs`
- `BatchDocumentStatus` includes `'retrying'` — retrying docs do NOT count toward `finishedCount`; `activeCount = processingCount + retryingCount + pendingCount`
- Confirm button disabled when `docs.some(d => d.status === 'processing' || d.status === 'retrying')`
- `api.ts` non-OK error throw now includes `httpStatus: res.status` and `retryAfter: number` (from Retry-After header)
- Tests: 27 frontend tests total (was 15 scanner-batch; added 12 rate-limit regression tests, tests 16–27)
