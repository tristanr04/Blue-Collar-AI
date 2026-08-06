---
name: BCFAI Sprints 3-8 outcomes
description: Key decisions and invariants from sprints 3 (Weekly Snapshot) through 8 (QA) completed 2026-08-05.
---

## Sprint 3 — Weekly Financial Snapshot
- `getWeeklyTrends(userId)` added to timeline-repository.ts; refactored to call shared `getTrendsSince(userId, since)`.
- `weekly-snapshot-service.ts` generates natural-language sentences from 7-day timeline deltas; saves to `financial_snapshots` table with `source = 'weekly_snapshot'` and full data in `metadata` JSONB.
- Sentence generation uses `generateSentences(trends, healthScoreDelta)` — returns "No financial changes recorded this week." when empty; never returns null array.
- Weekly snapshot route: `GET /api/weekly-snapshot/current` and `GET /api/weekly-snapshot/history`.
- Frontend: `WeeklySnapshot.tsx`, wired at `/weekly-snapshot`, lazy-loaded.

## Sprint 4 — Smarter AI
- System prompt tightened to 60–120 words default (was 80–180). `max_completion_tokens` reduced 650→400.
- Trusted context now includes `healthScore`, `healthConfidence`, `healthRecommendation`, and `weeklyChanges` object.
- `getWeeklyTrends` and `computeHealthScore`/`buildHealthScoreInputFromSnapshot` are best-effort in the AI route (non-fatal catch block).

## Sprint 5 — Tax Engine (All States)
- `state-tax-rates.ts` added: all 50 states + DC, covers `type: 'none'` (no-tax), `type: 'flat'`, and `type: 'brackets'` with single/joint tables.
- `calcStateTax(stateCode, federalTaxableIncome, filingStatus)` is the public API. Returns `{ tax, effectiveRate, entryFound, isNoTaxState, note }`.
- No-tax states (TX, FL, NV, etc.) return `tax: 0, isNoTaxState: true` — NOT null. Only truly unknown state codes return `tax: null` + warning.
- Tax engine `buildOpportunities` now takes `stateTaxRate` instead of `okTaxRate`; deduction descriptions use state code rather than hardcoded "Oklahoma".
- `calcOklahomaTax` private function removed; replaced by `calcStateTax`.

**Why:** The previous OK-only approach produced incorrect warnings for all non-OK users.

## Sprint 6 — Dashboard Completion
- Second row now has 5 cards (Cash, Investments, Retirement, Total Debt, Emergency Fund) — Utilization removed.
- Third row (Monthly cash flow section) now shows: Income, Bills, Utilization, Timeline link — matching spec.

## Known Gaps Fixed
- `command-center.ts` now fetches `getLatestTaxEstimateForAI` and wires `latestTaxEstimate` + `hasTaxEstimate` into `CommandCenterInput`.
- `health-score.ts` now sets `hasTaxEstimate: true` and computes `taxEstimateAgeDays` from `taxEstimate.updatedAt`.

## Sprint 7 — Performance
- `React.lazy()` code-splitting applied to all ~20 page components in `App.tsx`; `PageSkeleton` Suspense fallback added.
- `route-cache.ts` added: `commandCenterCache` (30 s TTL), `healthScoreCache` (60 s TTL) — per-user in-memory caches with 2000-entry soft cap.
- AI `max_completion_tokens` reduced to 400.

## Sprint 8 — QA Results
- Typecheck: ✅ clean across all 5 packages.
- API server tests: **433 pass, 0 fail**.
- Frontend tests: **272 pass, 0 fail**.
- api-zod tests: **114 pass, 0 fail**.
- Build: ✅ clean. All pages emit separate lazy chunks.

## Shared helper: buildHealthScoreInputFromSnapshot
- `lib/health-score-input-builder.ts` exports `buildHealthScoreInputFromSnapshot(snapshot)`.
- Used by health-score route, weekly-snapshot route, and ai-ask route (avoids duplication).
- Note: the builder always sets `hasTaxEstimate: false`; callers must override with a live tax estimate lookup if they want accurate tax readiness scoring.
