/**
 * Tests for AI guard middleware (src/middlewares/ai-guard.ts).
 *
 * Covers:
 *  - aiKillSwitch: blocked when AI_ENABLED=false/0, passes when true/unset
 *  - PerIpConcurrencySemaphore: acquire/release logic + 429 when full
 *  - GlobalConcurrencySemaphore: acquire/release logic + 429 when full
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import {
  aiKillSwitch,
  PerIpConcurrencySemaphore,
  GlobalConcurrencySemaphore,
} from "../middlewares/ai-guard.js";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function mockReq(ip = "1.2.3.4"): Request {
  return { ip, path: "/test", socket: { remoteAddress: ip } } as unknown as Request;
}

interface MockRes {
  statusCode: number;
  body: unknown;
  headers: Record<string, unknown>;
  finished: boolean;
  status(code: number): this;
  json(body: unknown): void;
  on(event: string, fn: () => void): this;
}

function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: null,
    headers: {},
    finished: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.finished = true; },
    on(_event, _fn) { return this; },
  };
  return res;
}

function mockNext(): { called: boolean; fn: NextFunction } {
  const state = { called: false };
  return {
    called: false,
    fn: () => { state.called = true; (state as { called: boolean }).called = true; },
  };
}

// ─── aiKillSwitch ─────────────────────────────────────────────────────────────

test("aiKillSwitch — passes through when AI_ENABLED is unset (default true)", () => {
  delete process.env.AI_ENABLED;
  const req = mockReq();
  const res = mockRes();
  let nextCalled = false;
  aiKillSwitch(req as Request, res as unknown as Response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.finished, false);
});

test("aiKillSwitch — passes through when AI_ENABLED=true", () => {
  process.env.AI_ENABLED = "true";
  const req = mockReq();
  const res = mockRes();
  let nextCalled = false;
  aiKillSwitch(req as Request, res as unknown as Response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.finished, false);
  delete process.env.AI_ENABLED;
});

test("aiKillSwitch — blocks and returns 503 when AI_ENABLED=false", () => {
  process.env.AI_ENABLED = "false";
  const req = mockReq();
  const res = mockRes();
  let nextCalled = false;
  aiKillSwitch(req as Request, res as unknown as Response, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 503);
  assert.equal((res.body as { stage: string }).stage, "ai_disabled");
  delete process.env.AI_ENABLED;
});

test("aiKillSwitch — blocks and returns 503 when AI_ENABLED=0", () => {
  process.env.AI_ENABLED = "0";
  const req = mockReq();
  const res = mockRes();
  let nextCalled = false;
  aiKillSwitch(req as Request, res as unknown as Response, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 503);
  delete process.env.AI_ENABLED;
});

test("aiKillSwitch — passes through when AI_ENABLED=1", () => {
  process.env.AI_ENABLED = "1";
  const req = mockReq();
  const res = mockRes();
  let nextCalled = false;
  aiKillSwitch(req as Request, res as unknown as Response, () => { nextCalled = true; });
  // "1" is not "false" or "0" so it should pass
  assert.equal(nextCalled, true);
  delete process.env.AI_ENABLED;
});

// ─── PerIpConcurrencySemaphore ────────────────────────────────────────────────

test("PerIpConcurrencySemaphore — acquire succeeds when under limit", () => {
  const sem = new PerIpConcurrencySemaphore(3, "test");
  assert.equal(sem.acquire("1.1.1.1"), true);
  assert.equal(sem.getCount("1.1.1.1"), 1);
});

test("PerIpConcurrencySemaphore — acquire fails at limit", () => {
  const sem = new PerIpConcurrencySemaphore(2, "test");
  assert.equal(sem.acquire("1.1.1.1"), true);
  assert.equal(sem.acquire("1.1.1.1"), true);
  assert.equal(sem.acquire("1.1.1.1"), false); // at limit
  assert.equal(sem.getCount("1.1.1.1"), 2);
});

test("PerIpConcurrencySemaphore — release decrements count", () => {
  const sem = new PerIpConcurrencySemaphore(3, "test");
  sem.acquire("1.1.1.1");
  sem.acquire("1.1.1.1");
  sem.release("1.1.1.1");
  assert.equal(sem.getCount("1.1.1.1"), 1);
});

test("PerIpConcurrencySemaphore — release to zero removes IP from map", () => {
  const sem = new PerIpConcurrencySemaphore(3, "test");
  sem.acquire("1.1.1.1");
  sem.release("1.1.1.1");
  assert.equal(sem.getCount("1.1.1.1"), 0);
});

test("PerIpConcurrencySemaphore — IPs are isolated from each other", () => {
  const sem = new PerIpConcurrencySemaphore(1, "test");
  assert.equal(sem.acquire("1.1.1.1"), true);
  assert.equal(sem.acquire("1.1.1.1"), false); // IP 1 is full
  assert.equal(sem.acquire("2.2.2.2"), true);  // IP 2 is independent
});

test("PerIpConcurrencySemaphore — middleware returns 429 when IP is at capacity", () => {
  const sem = new PerIpConcurrencySemaphore(1, "test");
  const middleware = sem.middleware();
  const ip = "5.5.5.5";

  // Simulate a request already in flight: manually acquire a slot.
  sem.acquire(ip);

  const req = mockReq(ip);
  const res = mockRes();
  let nextCalled = false;
  middleware(req as Request, res as unknown as Response, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 429);
  assert.equal((res.body as { stage: string }).stage, "concurrency_limit");
});

test("PerIpConcurrencySemaphore — middleware calls next and acquires slot when under limit", () => {
  const sem = new PerIpConcurrencySemaphore(3, "test");
  const middleware = sem.middleware();
  const ip = "6.6.6.6";

  const req = mockReq(ip);
  const res = mockRes();
  let nextCalled = false;
  middleware(req as Request, res as unknown as Response, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(sem.getCount(ip), 1);
});

// ─── GlobalConcurrencySemaphore ───────────────────────────────────────────────

test("GlobalConcurrencySemaphore — acquire succeeds when under limit", () => {
  const sem = new GlobalConcurrencySemaphore(5, "test");
  assert.equal(sem.acquire(), true);
  assert.equal(sem.active, 1);
});

test("GlobalConcurrencySemaphore — acquire fails at limit", () => {
  const sem = new GlobalConcurrencySemaphore(2, "test");
  assert.equal(sem.acquire(), true);
  assert.equal(sem.acquire(), true);
  assert.equal(sem.acquire(), false);
  assert.equal(sem.active, 2);
});

test("GlobalConcurrencySemaphore — release decrements active count", () => {
  const sem = new GlobalConcurrencySemaphore(5, "test");
  sem.acquire();
  sem.acquire();
  sem.release();
  assert.equal(sem.active, 1);
});

test("GlobalConcurrencySemaphore — middleware returns 429 when at capacity", () => {
  const sem = new GlobalConcurrencySemaphore(1, "test");
  const middleware = sem.middleware();
  sem.acquire(); // fill the single slot

  const req = mockReq();
  const res = mockRes();
  let nextCalled = false;
  middleware(req as Request, res as unknown as Response, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 429);
  assert.equal((res.body as { stage: string }).stage, "concurrency_limit");
});

test("GlobalConcurrencySemaphore — middleware calls next and increments active", () => {
  const sem = new GlobalConcurrencySemaphore(5, "test");
  const middleware = sem.middleware();

  const req = mockReq();
  const res = mockRes();
  let nextCalled = false;
  middleware(req as Request, res as unknown as Response, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(sem.active, 1);
});
