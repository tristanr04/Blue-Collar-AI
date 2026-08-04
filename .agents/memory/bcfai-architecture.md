---
name: BCFAI Architecture
description: Blue Collar Financial AI — key architecture decisions, routing, and integration patterns
---

## Stack
- Frontend: React + Vite + Wouter + Clerk auth (`artifacts/blue-collar-financial-ai`)
- API server: Express + Fastify-style routes + Drizzle ORM (`artifacts/api-server`)
- DB: PostgreSQL via `@workspace/db` (Drizzle schema in `lib/db/src/schema/financial.ts`)
- Auth: Clerk (publishable key in `VITE_CLERK_PUBLISHABLE_KEY`, secret in `CLERK_SECRET_KEY`)

## UUID Sync (Priority 1 — resolved)
The store uses `idPendingMap: useRef<Map<localId, Promise<serverId>>>` to track in-flight creates.
- `bgCreate()`: fires POST, resolves promise with server UUID, replaces localId in state + changeHistory.
- `bgWithIdSync()`: delete/update calls chain on the pending promise — never use localId for server ops.
- Optimistic UI preserved; no page refresh required after create.
**Why:** Local `crypto.randomUUID()` UUIDs diverge from server-assigned UUIDs; delete/update on a local UUID silently fails on the server.

## Fingerprint Persistence (Priority 2 — resolved)
- `lib/fingerprint.ts` (api-server): `computeFileFingerprint(buffer)` → SHA-256 hex.
  Identical to client `fingerprintFile()` (Web Crypto SHA-256) — same algorithm, same output.
- `scanned_documents` table has `UNIQUE(user_id, file_fingerprint)`.
- `scan.ts` checks fingerprint BEFORE AI call → rejects 409 on duplicate.
- `createScannedDocument` uses `ON CONFLICT DO NOTHING` — idempotent, returns `undefined` on dup.
- Duplicate detection is user-scoped: different users may upload the same file.
**Why:** Prevents re-importing the same physical file; saves AI quota.

## Migration UI (Priority 3 — resolved)
- `MigrationDialog.tsx`: 4-state modal (confirm/uploading/done/error), shows record counts per section.
- Rendered inside `StoreProvider` in `App.tsx`. Triggered by `migrationPending` store flag.
- No auto-migrate — user must click "Upload my data" explicitly.

## DTI Formula
- All DTI calculations use **gross** monthly income (`monthlyGross`), not net.
- Thresholds: 15% (excellent), 28% (acceptable), 36% (concerning) — lender-standard.

## Background Sync Pattern
- `bgSync(fn)`: fire-and-forget for profile saves.
- `bgCreate(localId, section, fn, buildPatch)`: replaces local UUID with server UUID on success.
- `bgWithIdSync(localId, fn)`: waits for any pending create before firing delete/update.

## Test Coverage
- 75 tests in `artifacts/api-server/src/__tests__/` (up from 60 at start of session).
- `financial-crud-regression.test.ts`: create→update→delete against real DB for debt/bill/asset/paystub.
- `fingerprint-security.test.ts`: determinism, distinctness, duplicate rejection, cross-user isolation.

## API Routes
- POST `/api/scan-document` — requires auth; computes fingerprint, rejects duplicates, stores doc record
- GET `/api/financial/snapshot` — load all records
- POST `/api/financial/profile` — upsert profile
- POST/PUT/DELETE `/api/financial/{paystubs,debts,bills,assets}` — CRUD all user-scoped

## Remaining Technical Debt
- ScannedDocument fingerprints not written through to the `scanned_documents` table from Scanner.tsx  
  (Scanner computes the fingerprint but the store's `addDocument` doesn't persist it to DB)
- Store CRUD functions return `localId` synchronously; callers (Scanner applyUpdatePlan) that hold  
  the ID for subsequent operations may still operate on a local UUID for a short window before server response
- No async `migrateLocalToServer` progress granularity (all-or-nothing; partial failures leave inconsistent state)
