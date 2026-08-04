---
name: BCFAI Architecture
description: Blue Collar Financial AI — key architecture decisions, routing, integration patterns, and QA findings
---

## Stack
- Frontend: React + Vite + Wouter + Clerk auth (`artifacts/blue-collar-financial-ai`)
- API server: Express 5 + Drizzle ORM (`artifacts/api-server`)
- DB: PostgreSQL via `@workspace/db` (Drizzle schema in `lib/db/src/schema/financial.ts`)
- Auth: Clerk (`VITE_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`)

## UUID Sync
`idPendingMap: useRef<Map<localId, Promise<serverId>>>` — `bgCreate()` resolves with server UUID and patches state; `bgWithIdSync()` chains deletes/updates on the promise so the server UUID is always used.
**Why:** Local `crypto.randomUUID()` diverges from server UUID; delete/update on a local UUID silently fails.

## Fingerprint Dedup
SHA-256 computed before AI call; 409 on duplicate; `UNIQUE(user_id, file_fingerprint)` in DB; user-scoped.

## AI Financial Context — ALWAYS load from DB
`POST /ai/ask` loads the authenticated user's financial snapshot from DB via `getFinancialSnapshot(userId)`. The client-supplied `financialProfile` is intentionally ignored. Monthly income is derived server-side from the latest paystub + pay frequency multiplier.
**Why:** The system prompt labels the context "trusted numeric output" — it must actually be server-verified.

## DTI Formula
All DTI uses **gross** monthly income (`monthlyGross`). Thresholds: 15% excellent / 28% acceptable / 36% concerning.

## Emergency Fund — Infinity guard
`emergencyMonths = Infinity` when `liquidCash > 0 AND monthlyExpenses === 0`. Dashboard shows "∞ mo". `JSON.stringify(Infinity) = null` but `computeMetrics` always recalculates on load so no stale state issue.

## API Routes (complete)
- POST `/api/scan-document` — auth required; fingerprint check; doc persistence
- GET `/api/financial/snapshot`
- POST `/api/financial/profile`
- POST/DELETE `/api/financial/paystubs`
- **PUT `/api/financial/paystubs/:id`** — added in QA pass (OCR correction)
- POST/PUT/DELETE `/api/financial/{debts,bills,assets}`
- POST `/api/ai/ask` — streams SSE; loads snapshot from DB; 503 on DB failure
- GET/GET `:id` `/api/jobs` — auth + user-scoped background job polling

## Document Scanner — AI Response Parsing
`extractFromImage`/`extractFromText` return the **full response object** (not just the content string).
Handler applies: `getModelOutput(aiResponse)` → `unwrapDocumentResponse(modelOutput)` → parse.
`getModelOutput` handles `output_text` (Responses API), `choices[0].message.content` (Chat API), `content[0].text`, `output[0].content[0].text`, and others.
**Why:** `gpt-5.6-terra` may return `output_text` instead of `choices[0].message.content`; the old code silently yielded `"{}"` which failed Zod validation for every scan.

## Auto Loan — Two-Path Response
Auto Loan documents use a **vehicle-loan fast path** that bypasses Zod validation entirely.
- Server detects `docType === "Auto Loan"` (or presence of `balanceOwed`/`loanTerm`/`paymentsMade` without `docType`)
- Calls `normalizeVehicleLoanExtraction(flattenWrappedFields(rawExtraction))`
- Returns `{ success, documentType: "vehicleLoan", type: "vehicleLoan", data, extraction, docType: "Auto Loan", fields: {} }`
- Derives `monthsRemaining = loanTerm - paymentsMade` when not explicit; converts US dates to ISO
- Frontend detects via `result.type === 'vehicleLoan'` and builds `fieldMap` from `result.data` (flat values, NOT wrapped)
Canonical keys: `loanName`, `accountLast4`, `balanceOwed`, `originalAmount`, `apr`, `monthlyPayment`, `monthsRemaining`, `nextDueDate`.
Personal Loan and Student Loan still use old field names — known debt.

## drizzle-zod Compatibility
drizzle-zod@0.8.3 expects Zod v4 `_zod` internals but project uses Zod v3.25.76.
Fix: replace `createInsertSchema`/`createSelectSchema` with plain `z.object({...})` in `lib/db/src/schema/profile-context.ts`.
**Why:** Do not upgrade drizzle-zod to fix this — it pulls in Zod v4 which breaks the rest of the codebase.

## profileContext Store Pattern
`artifacts/blue-collar-financial-ai/src/lib/store.tsx` holds `profileContext` (birth date, state, tax filing status, dependents, pre-tax deductions).
Auto-loads after server sync; cleared on logout; duplicate-load guard via `profileContextLoadingRef`.
Used by: AgeBenchmarkCard (age + stateCode), TaxEstimatorCard, Settings form.

## Tax Estimator — Annual Multipliers
Dashboard passes annual wage to `TaxEstimatorCard` using period multipliers: Weekly=52, Biweekly=26, Semimonthly=24, Monthly=12.
Do NOT use 4.33/2.17 (those are monthly-to-annual for gross pay display only, not for annual wage calculation).

## Test Coverage
- 132 tests in `artifacts/api-server/src/__tests__/` (all pass)
- 45 tests in `artifacts/blue-collar-financial-ai/src/` (all pass via Vitest)
- Key suites: financial-crud-regression, fingerprint-security, paystub-update-regression, upload-security, timeout-middleware, vehicle-loan-normalization, profile-context-api, tax-estimator

## Rate Limiting
IP-based (not user-based): general 100/15min, AI ask 20/hour, scanner 10/hour. Behind a proxy `trust proxy` must be set correctly or all requests share one IP bucket.

## Migration UI
4-state modal (confirm/uploading/done/error). Sequential awaits — partial failure on retry can create duplicate records (no idempotency key). Known debt.

## Remaining Technical Debt
- `/api/capabilities` reveals `{ ai: boolean }` without authentication (LOW — no user data exposure)
- `migrateLocalToServer` is not idempotent; retry after mid-run failure can duplicate records
- No maximum length validation on text fields (debt/bill names) — bounded only by DB `text` type
- No paystub future-date validation — future payDates accepted and sorted as "most recent"
- Rate limits are IP-based; a single IP can exhaust another user's quota (multi-tenant concern)
- Personal Loan / Student Loan field names not yet normalized server-side (Task #22)
- `safeParseJson` parse paths not covered by automated tests (Task #21)
- Console.log statements in vehicle loan normalization and scan response parsing are always on (not gated on NODE_ENV)
