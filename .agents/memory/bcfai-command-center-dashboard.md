---
name: BCFAI Command Center Dashboard
description: Dashboard is now server-driven via GET /api/command-center/summary; CommandCenterSummary type was extended; display helpers live in dashboard-utils.ts.
---

## What changed

`CommandCenterSummary` (lib/command-center-summary.ts) now returns **5 additional `CommandCenterMetric` fields** that were previously only used internally:
- `monthlyIncome`, `monthlyBills`, `monthlyDebtPayments` — breakdown for cash-flow section
- `retirement` — split from `investments` (investments is now non-retirement only)
- `creditUtilization` — as a percentage (0–100)

The `investments` metric is now **non-retirement brokerage only**. Any test expecting the old merged value (`investments + retirement`) must be updated.

## Architecture

- `artifacts/blue-collar-financial-ai/src/lib/dashboard-utils.ts` — pure display helpers (resolveMetric, resolveCashFlow, resolveTaxEstimate, resolveNextBestMove, resolveHealthScore). Tested independently without DOM.
- `Dashboard.tsx` — fetches `/api/command-center/summary` with Clerk token via `useAuth().getToken()`. No client-side recalculation of server-provided totals. Shows loading skeleton, API error banner with retry, and contextual empty-state prompts instead of fake $0.
- `api.ts` — `getCommandCenterSummary(token)` uses the existing `financialFetch` wrapper.

## Key rules

**Why:** Missing values must never display as $0 — use `resolveMetric()` which returns `{kind:'empty', prompt}` when `status === 'missing'` or `value === null`. Callers render the prompt, never a dollar amount.

**How to apply:** Always pass server metrics through `resolveMetric`/`resolveCashFlow`/`resolveTaxEstimate` before rendering. Never fall back to `|| 0` on a metric value.

## Test note

The Node test runner in api-server uses UTF-8 curly apostrophes in string literals (e.g. "Put this month\u2019s surplus to work"). Use `.includes('surplus')` or `assert.ok(title.includes(...))` rather than exact string equality to avoid encoding mismatches.
