---
name: BCFAI Subscription & Billing
description: Architecture decisions and patterns for the subscription/billing system built in Task #31.
---

# Subscription & Billing — Key Decisions

## Webhook raw-body parser placement
`express.raw({ type: 'application/json' })` is mounted at `/api/webhooks/stripe` in `app.ts` BEFORE `express.json()`. The webhook router is also mounted there (not via `routes/index.ts`). Stripe signature verification requires the unmodified raw Buffer.

**Why:** express.json() destroys the raw body needed for `stripe.webhooks.constructEvent()`.

**How to apply:** Any new webhook endpoint needing raw body must follow the same pattern in `app.ts`.

## Webhook router route path must be `"/"`
The webhook router is mounted at `/api/webhooks/stripe` via `app.use(...)`. Inside `createWebhookRouter()`, the route handler must be `router.post("/", ...)` — NOT `router.post("/webhooks/stripe", ...)`.

**Why:** Express strips the mount prefix before passing to the router. Repeating the path creates `/api/webhooks/stripe/webhooks/stripe` which never matches.

## Dependency injection for testable routes
`webhook-stripe.ts` exports `createWebhookRouter(deps?: WebhookDeps)` — a factory that takes injected fns. `export default createWebhookRouter()` uses real deps in production.

**Why:** Node's `node:test` runner does NOT support `mock.module()` (available in newer Node but not via the tsx/ESM loading chain used here). DI avoids module-level mocking entirely.

## Stripe graceful degradation
`stripeIsConfigured()` checks all three env vars: `STRIPE_SECRET_KEY`, `STRIPE_PRO_PRICE_ID`, `STRIPE_BUSINESS_PRICE_ID`. When any is absent, checkout returns `{ available: false }` and the frontend shows "checkout temporarily unavailable". No 500 errors.

## Scan usage recording pattern
`checkScanEntitlement` middleware records usage via `res.on('finish', ...)` so the scan handler itself needs no modification regardless of how many success paths it has.

## `markStripeEventProcessed` returns `Promise<boolean>` not `Promise<void>`
The subscription-repository function returns boolean. `WebhookDeps` interface uses `Promise<boolean | void>` to accommodate both the real impl and test stubs that return void.

## Test runner: Node built-in, not Vitest
API server tests use `node --import tsx/esm --test`. Import: `import { test, describe, before, after } from "node:test"` and `import assert from "node:assert/strict"`. No `vi.mock()`, no Vitest APIs.
