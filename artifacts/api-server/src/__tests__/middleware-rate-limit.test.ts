/**
 * Tests for rate limit middleware (src/middlewares/rate-limit.ts).
 *
 * Uses a real Express server on a random port + fetch to verify:
 *  - Requests under the limit succeed (200)
 *  - Requests over the limit return 429 with correct body and Retry-After header
 *  - RateLimit-* standard headers are present on normal responses
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createLimiter } from "../middlewares/rate-limit.js";

// ─── Test server helper ───────────────────────────────────────────────────────

async function startServer(
  limitCount: number,
  windowMs = 60_000,
): Promise<{ url: string; close: () => void }> {
  const limiter = createLimiter({
    windowMs,
    limit: limitCount,
    label: "test_route",
  });

  const app = express();
  app.use(limiter);
  app.get("/ping", (_req, res) => res.json({ ok: true }));

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => server.close(),
      });
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("rate limiter — requests under the limit return 200", async (t) => {
  const { url, close } = await startServer(5);
  t.after(() => close());

  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${url}/ping`);
    assert.equal(res.status, 200, `Request ${i + 1} should succeed`);
  }
});

test("rate limiter — request over the limit returns 429", async (t) => {
  const { url, close } = await startServer(3);
  t.after(() => close());

  // Exhaust the limit.
  for (let i = 0; i < 3; i++) {
    await fetch(`${url}/ping`);
  }

  const res = await fetch(`${url}/ping`);
  assert.equal(res.status, 429);
});

test("rate limiter — 429 body has correct shape", async (t) => {
  const { url, close } = await startServer(2);
  t.after(() => close());

  await fetch(`${url}/ping`);
  await fetch(`${url}/ping`);

  const res = await fetch(`${url}/ping`);
  assert.equal(res.status, 429);

  const body = await res.json() as { stage: string; error: string; retryAfter: number };
  assert.equal(body.stage, "rate_limit");
  assert.match(body.error, /too many requests/i);
  assert.equal(typeof body.retryAfter, "number");
  assert.ok(body.retryAfter >= 0);
});

test("rate limiter — Retry-After header is set on 429", async (t) => {
  const { url, close } = await startServer(1);
  t.after(() => close());

  await fetch(`${url}/ping`);
  const res = await fetch(`${url}/ping`);

  assert.equal(res.status, 429);
  const retryAfter = res.headers.get("Retry-After");
  assert.ok(retryAfter !== null, "Retry-After header should be present");
  assert.ok(Number(retryAfter) >= 0, "Retry-After should be a non-negative number");
});

test("rate limiter — RateLimit standard headers are present on normal response", async (t) => {
  const { url, close } = await startServer(10);
  t.after(() => close());

  const res = await fetch(`${url}/ping`);
  assert.equal(res.status, 200);

  // draft-7 uses 'ratelimit' (lowercase in fetch response)
  const rlHeader = res.headers.get("ratelimit") ?? res.headers.get("RateLimit");
  assert.ok(rlHeader !== null, "RateLimit header should be present");
});

test("rate limiter — limit resets after window (fast window test)", async (t) => {
  // Use a 200ms window so we can verify reset without waiting.
  const { url, close } = await startServer(2, 200);
  t.after(() => close());

  // Exhaust the limit.
  await fetch(`${url}/ping`);
  await fetch(`${url}/ping`);
  const over = await fetch(`${url}/ping`);
  assert.equal(over.status, 429);

  // Wait for the window to reset.
  await new Promise((r) => setTimeout(r, 250));

  const after = await fetch(`${url}/ping`);
  assert.equal(after.status, 200, "Request should succeed after window reset");
});
