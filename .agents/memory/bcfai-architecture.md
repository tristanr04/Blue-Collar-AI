---
name: BCFAI Architecture
description: Frontend-only localStorage app + API server for AI scan/chat; key routing, integration details, and milestone inventory.
---

## Stack
- React + Vite + Wouter (frontend) — `artifacts/blue-collar-financial-ai`
- Express + Drizzle + PostgreSQL (API) — `artifacts/api-server`
- Clerk auth (Replit-managed)
- Design system — `artifacts/bcfai-ds`
- Shared DB lib — `lib/db` (must run `tsc` after schema changes)

## Key routing
- All API routes live under `/api/...` via `routes/index.ts`
- Financial mutations: `routes/financial-data.ts`
- Tax scenarios: `routes/tax-scenarios.ts`
- Command center: `routes/command-center.ts`
- Timeline: `routes/timeline.ts` → `GET /api/timeline/summary`
- Frontend routes registered in `App.tsx`; nav items in `Shell.tsx`

## DB schema (lib/db/src/schema/financial.ts)
Tables: users, profiles, paystubs, debts, bills, assets, scannedDocuments, taxScenarios, timelineEvents

## Milestones completed
1. AI document scanner with 429 queue
2. Tax estimator (versioned engine, DB-persisted scenarios)
3. Financial Command Center dashboard (server-driven, dashboard-utils.ts)
4. Financial Timeline (timelineEventsTable, lazy backfill, monthly trends, Timeline.tsx page)

## Known gaps
- `command-center.ts:133` hardcodes `latestTaxEstimate: null` — tax estimate card always shows empty even if user has saved scenarios.

**Why:** localStorage is not user-scoped (historical choice); server is authoritative for all summaries.
