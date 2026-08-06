/**
 * Tests for the Stripe webhook handler (src/routes/webhook-stripe.ts).
 *
 * Uses dependency injection via createWebhookRouter() — no module mocking needed.
 * Uses Node.js built-in test runner (node:test + node:assert/strict).
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createWebhookRouter, type WebhookDeps } from "../routes/webhook-stripe.js";
import type Stripe from "stripe";

// ─── Server factory (creates a fresh server for each describe block) ──────────

function buildApp(deps: Partial<WebhookDeps> = {}) {
  const fullDeps: WebhookDeps = {
    constructStripeEvent: async () => { throw new Error("Not configured"); },
    isStripeEventProcessed: async () => false,
    markStripeEventProcessed: async () => {},
    upsertSubscription: async () => {},
    storeStripeCustomerId: async () => {},
    getUserIdByStripeCustomerId: async () => null,
    ...deps,
  };
  const app = express();
  app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }));
  app.use("/api/webhooks/stripe", createWebhookRouter(fullDeps));
  return app;
}

function startServer(deps: Partial<WebhookDeps> = {}): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const app    = buildApp(deps);
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStripeEvent(type: string, object: Record<string, unknown>, id?: string) {
  return { id: id ?? `evt_${type.replace(/\./g, "_")}`, type, data: { object } } as unknown as Stripe.Event;
}

function makeStripeSub(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_123", customer: "cus_test", status: "active",
    current_period_start: 1700000000, current_period_end: 1702592000,
    cancel_at_period_end: false, canceled_at: null,
    items: { data: [{ price: { id: "price_pro" } }] },
    ...overrides,
  };
}

async function postWebhook(url: string, body: unknown, sig = "valid_sig") {
  return fetch(`${url}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": sig },
    body: JSON.stringify(body),
  });
}

// ─── Validation tests ─────────────────────────────────────────────────────────

describe("webhook — request validation", () => {
  let url: string;
  let close: () => Promise<void>;

  before(async () => {
    ({ url, close } = await startServer());
  });
  after(async () => close());

  test("returns 400 when stripe-signature header is missing", async () => {
    const res = await fetch(`${url}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 400);
  });

  test("returns 400 when constructStripeEvent throws (bad signature)", async () => {
    // Default deps throw on constructStripeEvent
    const res = await postWebhook(url, {});
    assert.equal(res.status, 400);
    const body = await res.json() as Record<string, string>;
    assert.ok(body.error, "error field should be present");
  });
});

describe("webhook — signature error message propagation", () => {
  let url: string;
  let close: () => Promise<void>;

  before(async () => {
    ({ url, close } = await startServer({
      constructStripeEvent: async () => { throw new Error("Invalid signature"); },
    }));
  });
  after(async () => close());

  test("error message from constructStripeEvent is included in response", async () => {
    const res = await postWebhook(url, {});
    assert.equal(res.status, 400);
    const body = await res.json() as Record<string, string>;
    assert.match(body.error, /Invalid signature/i);
  });
});

// ─── Idempotency tests ────────────────────────────────────────────────────────

describe("webhook — idempotency", () => {
  test("returns skipped=already_processed for duplicate events without calling upsert", async () => {
    let upsertCalled = false;
    const event = makeStripeEvent("customer.subscription.updated", makeStripeSub());
    const { url, close } = await startServer({
      constructStripeEvent: async () => event,
      isStripeEventProcessed: async () => true, // already processed
      upsertSubscription: async () => { upsertCalled = true; },
    });

    const res = await postWebhook(url, event);
    await close();

    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.skipped, "already_processed");
    assert.equal(upsertCalled, false);
  });

  test("marks event as processed after handling it", async () => {
    let markedId: string | null = null;
    const event = makeStripeEvent("invoice.paid", { customer: "cus_test" });
    const { url, close } = await startServer({
      constructStripeEvent: async () => event,
      isStripeEventProcessed: async () => false,
      markStripeEventProcessed: async (id) => { markedId = id; },
      getUserIdByStripeCustomerId: async () => "user_123",
    });

    await postWebhook(url, event);
    await close();
    assert.equal(markedId, event.id);
  });
});

// ─── customer.subscription.created ───────────────────────────────────────────

describe("webhook — customer.subscription.created", () => {
  test("upserts with plan=pro and status=active", async () => {
    let upsertArgs: [string, Record<string, unknown>] | null = null;
    const sub   = makeStripeSub({ status: "active" });
    const event = makeStripeEvent("customer.subscription.created", sub);

    process.env.STRIPE_PRO_PRICE_ID = "price_pro";
    const { url, close } = await startServer({
      constructStripeEvent: async () => event,
      isStripeEventProcessed: async () => false,
      getUserIdByStripeCustomerId: async () => "user_abc",
      upsertSubscription: async (uid, data) => { upsertArgs = [uid, data as Record<string, unknown>]; },
    });

    const res = await postWebhook(url, event);
    await close();
    delete process.env.STRIPE_PRO_PRICE_ID;

    assert.equal(res.status, 200);
    assert.ok(upsertArgs, "upsert should have been called");
    const [uid, data] = upsertArgs!;
    assert.equal(uid, "user_abc");
    assert.equal(data.plan, "pro");
    assert.equal(data.status, "active");
  });
});

// ─── customer.subscription.updated ───────────────────────────────────────────

describe("webhook — customer.subscription.updated", () => {
  test("updates status to past_due when subscription changes", async () => {
    let upsertData: Record<string, unknown> | null = null;
    const sub   = makeStripeSub({ status: "past_due" });
    const event = makeStripeEvent("customer.subscription.updated", sub);

    const { url, close } = await startServer({
      constructStripeEvent: async () => event,
      isStripeEventProcessed: async () => false,
      getUserIdByStripeCustomerId: async () => "user_abc",
      upsertSubscription: async (_uid, data) => { upsertData = data as Record<string, unknown>; },
    });
    await postWebhook(url, event);
    await close();

    assert.ok(upsertData);
    assert.equal(upsertData.status, "past_due");
  });
});

// ─── customer.subscription.deleted ───────────────────────────────────────────

describe("webhook — customer.subscription.deleted", () => {
  test("sets plan=free and status=canceled on deletion", async () => {
    let upsertData: Record<string, unknown> | null = null;
    const sub   = makeStripeSub({ status: "canceled", canceled_at: 1700000100 });
    const event = makeStripeEvent("customer.subscription.deleted", sub);

    const { url, close } = await startServer({
      constructStripeEvent: async () => event,
      isStripeEventProcessed: async () => false,
      getUserIdByStripeCustomerId: async () => "user_abc",
      upsertSubscription: async (_uid, data) => { upsertData = data as Record<string, unknown>; },
    });
    await postWebhook(url, event);
    await close();

    assert.ok(upsertData);
    assert.equal(upsertData.plan, "free");
    assert.equal(upsertData.status, "canceled");
  });
});

// ─── invoice.paid ─────────────────────────────────────────────────────────────

describe("webhook — invoice.paid", () => {
  test("sets subscription status to active", async () => {
    let upsertData: Record<string, unknown> | null = null;
    const event = makeStripeEvent("invoice.paid", { customer: "cus_test" });

    const { url, close } = await startServer({
      constructStripeEvent: async () => event,
      isStripeEventProcessed: async () => false,
      getUserIdByStripeCustomerId: async () => "user_abc",
      upsertSubscription: async (_uid, data) => { upsertData = data as Record<string, unknown>; },
    });
    await postWebhook(url, event);
    await close();

    assert.ok(upsertData);
    assert.equal(upsertData.status, "active");
  });
});

// ─── invoice.payment_failed ───────────────────────────────────────────────────

describe("webhook — invoice.payment_failed", () => {
  test("sets subscription status to past_due", async () => {
    let upsertData: Record<string, unknown> | null = null;
    const event = makeStripeEvent("invoice.payment_failed", { customer: "cus_test" });

    const { url, close } = await startServer({
      constructStripeEvent: async () => event,
      isStripeEventProcessed: async () => false,
      getUserIdByStripeCustomerId: async () => "user_abc",
      upsertSubscription: async (_uid, data) => { upsertData = data as Record<string, unknown>; },
    });
    await postWebhook(url, event);
    await close();

    assert.ok(upsertData);
    assert.equal(upsertData.status, "past_due");
  });
});

// ─── Unknown Stripe customer ──────────────────────────────────────────────────

describe("webhook — unknown Stripe customer", () => {
  test("skips upsert gracefully when no userId found for customer", async () => {
    let upsertCalled = false;
    const event = makeStripeEvent("customer.subscription.updated", makeStripeSub());

    const { url, close } = await startServer({
      constructStripeEvent: async () => event,
      isStripeEventProcessed: async () => false,
      getUserIdByStripeCustomerId: async () => null, // no user
      upsertSubscription: async () => { upsertCalled = true; },
    });
    const res = await postWebhook(url, event);
    await close();

    assert.equal(res.status, 200);
    assert.equal(upsertCalled, false);
  });
});

// ─── checkout.session.completed ──────────────────────────────────────────────

describe("webhook — checkout.session.completed", () => {
  test("stores Stripe customer ID when client_reference_id is present", async () => {
    let storedPair: [string, string] | null = null;
    const session = { id: "cs_x", customer: "cus_new", client_reference_id: "user_xyz", metadata: {} };
    const event   = makeStripeEvent("checkout.session.completed", session);

    const { url, close } = await startServer({
      constructStripeEvent: async () => event,
      isStripeEventProcessed: async () => false,
      storeStripeCustomerId: async (uid, cid) => { storedPair = [uid, cid]; },
    });
    const res = await postWebhook(url, event);
    await close();

    assert.equal(res.status, 200);
    assert.ok(storedPair);
    assert.deepEqual(storedPair, ["user_xyz", "cus_new"]);
  });

  test("skips customer storage when no userId found in session", async () => {
    let storeCalled = false;
    const session = { id: "cs_x", customer: "cus_new", client_reference_id: null, metadata: {} };
    const event   = makeStripeEvent("checkout.session.completed", session);

    const { url, close } = await startServer({
      constructStripeEvent: async () => event,
      isStripeEventProcessed: async () => false,
      storeStripeCustomerId: async () => { storeCalled = true; },
    });
    await postWebhook(url, event);
    await close();

    assert.equal(storeCalled, false);
  });
});

// ─── Unknown event type ───────────────────────────────────────────────────────

describe("webhook — unknown event type", () => {
  test("returns 200 and received=true for unhandled event types", async () => {
    const event = makeStripeEvent("some.unknown.event", { foo: "bar" });

    const { url, close } = await startServer({
      constructStripeEvent: async () => event,
      isStripeEventProcessed: async () => false,
    });
    const res = await postWebhook(url, event);
    await close();

    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.received, true);
  });
});
