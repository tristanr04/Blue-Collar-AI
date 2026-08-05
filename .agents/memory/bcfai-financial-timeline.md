---
name: BCFAI Financial Timeline
description: How the financial timeline feature is structured — DB schema, events table, backfill, idempotency, and monthly trends.
---

## DB table: timelineEventsTable
- Added to `lib/db/src/schema/financial.ts`
- Indexes: `(userId, eventDate)` and unique `(userId, idempotencyKey)`
- Schema pushed via `pnpm --filter @workspace/db run push-force`

## Idempotency key format
- New record: `{eventType}:{sourceRecordId}:{YYYY-MM-DD}`
- Backfill: `backfill:{type}:{id}`
- ON CONFLICT DO NOTHING — safe to retry/replay

## Key files
- `lib/timeline-repository.ts` — `appendTimelineEvent`, `listTimelineEvents`, `getMonthlyTrends`, `backfillTimeline`
- `lib/timeline-events.ts` — pure constructors: `makePaystubEvent`, `makeAssetEvent`, `makeDebtEvent`, `makeBillEvent`, `makeTaxEstimateEvent`
- `routes/timeline.ts` — `GET /api/timeline/summary` (lazy backfill + events + trends)
- `src/pages/Timeline.tsx` — frontend page (mobile-first, event cards, monthly trends)
- `src/lib/timeline-utils.ts` — pure display helpers (resolveChange, resolveTrend, etc.)

## How events are created
- POST/PUT financial routes: fire-and-forget `recordTimeline(make*Event(...))` after successful DB write
- `getPaystubById/getDebtById/getBillById/getAssetById` were added to financial-repository.ts to pre-fetch previous values before updates
- Tax scenarios routes also fire `makeTaxEstimateEvent` after create/update

## Monthly trends rule
- Null = no data this month → never fake $0
- Net worth = (cash + invest + retire) - debt, only counting categories with real events

**Why:** "Never fake $0" is a core product rule — null and confirmed-zero are meaningfully different for trades workers with irregular income.
