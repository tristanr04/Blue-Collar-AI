---
name: BCFAI Sprint Backtest Results
description: Phase 1-3 sprint results — final test counts, new features, API fixes
---

## Final Test Counts (August 2026 sprint)
- **API server:** 601 pass, 0 fail (up from 505)
- **Frontend:** 272 pass, 0 fail (unchanged)
- Both TypeChecks: clean (0 errors)

## New Features Delivered This Sprint

### DB Schema (lib/db/src/schema/)
- `financial.ts` — `financialGoalsTable`, `debtPayoffPlansTable`
- `workspaces.ts` — `workspacesTable`, `workspaceMembershipsTable`, `workspaceInvitationsTable`
- Migration `0006_goals_workspaces_payoff.sql` — applied to live DB

### API Routes (artifacts/api-server/src/routes/)
- `goals.ts` — full CRUD + contribute + emergency-fund upsert
- `debt-payoff.ts` — ephemeral calculator + saved plan CRUD
- `workspaces.ts` — full workspace + member + invitation endpoints
- `export.ts` — personal data export (rate-limited JSON attachment)

### Frontend Pages
- `Goals.tsx` — create, contribute, pause, archive, progress bars
- `Workspaces.tsx` — create, invite, member list, promote, remove, transfer
- `Debts.tsx` — rewritten with two tabs: Tracking and Payoff Planner (calls debt-payoff API)
- `GrowthHub.tsx` — referral code from real API, live stats dashboard

### Navigation
- App.tsx: added `/goals` and `/workspaces` routes
- Shell.tsx: added Goals (Target icon) and Workspaces (Building2 icon) nav items

## Bug Fixes
- `subscription-repository.ts` — `subscription_plan` and `subscription_status` enum params now explicitly cast (::subscription_plan, ::subscription_status) to prevent "expression is of type text" Postgres error
- `lib/db/src/schema/workspaces.ts` — fixed `isNotNull()` import (from drizzle-orm not column method)
- All new route `req.params` usages wrapped in `String()` to satisfy TS `string | string[]` type

## Phase 2 Test Coverage Added
- `goals-regression.test.ts` — ownership, contribute clamping, emergency-fund idempotency
- `payoff-calculator.test.ts` — avalanche/snowball/utilization/custom, interest math, zero-debt
- `workspace-regression.test.ts` — seat limits, invite reuse, circular-promotion, only-owner guard, cross-workspace denial
- `referral-circular-regression.test.ts` — self-referral, direct cycle, 3-hop cycle, tampered code

## Phase 3 Journey Scenarios (journey-scenarios.test.ts)
- Scenario A: Free user (entitlements, scan limits, upgrade gates)
- Scenario B: Irregular-income worker (paystubs, tax scenarios)
- Scenario C: Debt-heavy user (payoff planner, goals, contributions)
- Scenario D: Paid subscriber (upgrade, gated entitlements, downgrade)
- Scenario E: Referral flow (code, attribution, circular prevention)
- Scenario F: Business workspace (create, invite, roles, seat limits, cross-ws, only-owner)
- Scenario G: Destructive/recovery (archive, re-create, idempotency, cross-user isolation)

## Key API Notes
- `checkEntitlement({ plan, feature, used, requested? })` returns `{ allowed, limit, remaining, upgradeRequired }` — NOT a boolean
- Feature names: `"document_scan"`, `"ai_question"`, `"tax_scenario"`, `"cloud_document"` — no "workspaces" MeteredFeature exists
- `createTaxScenario` requires `{ name, taxYear, inputs, result }` — all required, no optional helpers
- `createPaystub` uses `regularHours`/`overtimeHours`/`doubleTimeHours`, not a single `hours` field
- `WorkspaceError` has `.code` property with values: `"forbidden"`, `"seat_limit_exceeded"`, `"invalid_invitation"`, `"cannot_remove_only_owner"`, `"cannot_transfer_to_non_member"`
- `ReferralError` has `.code` with values: `"self_referral"`, `"circular_referral"`, `"code_not_found"`, `"already_attributed"`
