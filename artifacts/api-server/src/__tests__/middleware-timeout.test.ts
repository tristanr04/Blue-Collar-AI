/**
 * Tests for timeout middleware (src/middlewares/timeout.ts).
 *
 * Covers:
 *  - requestTimeout middleware: fires 504 after delay, does NOT fire if res ends first
 *  - makeAbortController: signal aborts after timeout, clears on manual clearTimeout,
 *    also aborts on res close
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import { requestTimeout, makeAbortController } from "../middlewares/timeout.js";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

interface MockRes {
  statusCode: number;
  body: unknown;
  headersSent: boolean;
  listeners: Map<string, Array<() => void>>;
  status(code: number): this;
  json(body: unknown): void;
  end(): void;
  on(event: string, fn: () => void): this;
  emit(event: string): void;
}

function makeMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: null,
    headersSent: false,
    listeners: new Map(),
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.headersSent = true; },
    end() { this.headersSent = true; },
    on(event, fn) {
      const arr = this.listeners.get(event) ?? [];
      arr.push(fn);
      this.listeners.set(event, arr);
      return this;
    },
    emit(event) {
      for (const fn of this.listeners.get(event) ?? []) fn();
    },
  };
  return res;
}

function mockReq(): Request {
  return { ip: "1.2.3.4", path: "/test", socket: { remoteAddress: "1.2.3.4" } } as unknown as Request;
}

// ─── requestTimeout ───────────────────────────────────────────────────────────

test("requestTimeout — fires 504 when response is not sent within deadline", async () => {
  const middleware = requestTimeout(50); // 50 ms
  const req = mockReq();
  const res = makeMockRes();

  middleware(req, res as unknown as Response, (() => {}) as NextFunction);

  // Wait longer than the timeout.
  await new Promise((r) => setTimeout(r, 100));

  assert.equal(res.statusCode, 504);
  assert.equal((res.body as { stage: string }).stage, "request_timeout");
});

test("requestTimeout — does NOT fire when response ends before deadline", async () => {
  const middleware = requestTimeout(200); // 200 ms
  const req = mockReq();
  const res = makeMockRes();

  middleware(req, res as unknown as Response, (() => {}) as NextFunction);

  // End the response immediately.
  res.emit("finish");

  // Wait past the deadline.
  await new Promise((r) => setTimeout(r, 300));

  // Should still be 200 (not overridden to 504).
  assert.equal(res.statusCode, 200);
});

test("requestTimeout — does NOT fire when client closes before deadline", async () => {
  const middleware = requestTimeout(200);
  const req = mockReq();
  const res = makeMockRes();

  middleware(req, res as unknown as Response, (() => {}) as NextFunction);

  // Simulate client disconnect.
  res.emit("close");

  await new Promise((r) => setTimeout(r, 300));

  assert.equal(res.statusCode, 200);
});

test("requestTimeout — calls next()", () => {
  const middleware = requestTimeout(5000);
  const req = mockReq();
  const res = makeMockRes();
  let nextCalled = false;

  middleware(req, res as unknown as Response, (() => { nextCalled = true; }) as NextFunction);
  res.emit("finish");

  assert.equal(nextCalled, true);
});

// ─── makeAbortController ──────────────────────────────────────────────────────

test("makeAbortController — signal is not aborted initially", () => {
  const res = makeMockRes();
  const abort = makeAbortController(res as unknown as Response, 5000);
  assert.equal(abort.signal.aborted, false);
  abort.clearTimeout();
});

test("makeAbortController — signal aborts after timeout", async () => {
  const res = makeMockRes();
  const abort = makeAbortController(res as unknown as Response, 50);

  await new Promise((r) => setTimeout(r, 100));
  assert.equal(abort.signal.aborted, true);
});

test("makeAbortController — clearTimeout prevents abort", async () => {
  const res = makeMockRes();
  const abort = makeAbortController(res as unknown as Response, 50);

  abort.clearTimeout();

  await new Promise((r) => setTimeout(r, 100));
  assert.equal(abort.signal.aborted, false, "Should not be aborted after clearTimeout");
});

test("makeAbortController — abort() immediately aborts signal", () => {
  const res = makeMockRes();
  const abort = makeAbortController(res as unknown as Response, 5000);

  assert.equal(abort.signal.aborted, false);
  abort.abort();
  assert.equal(abort.signal.aborted, true);
});

test("makeAbortController — res close event aborts signal", () => {
  const res = makeMockRes();
  const abort = makeAbortController(res as unknown as Response, 5000);

  assert.equal(abort.signal.aborted, false);
  res.emit("close");
  assert.equal(abort.signal.aborted, true);
  abort.clearTimeout();
});

test("makeAbortController — calling clearTimeout twice is safe (no throw)", () => {
  const res = makeMockRes();
  const abort = makeAbortController(res as unknown as Response, 5000);
  abort.clearTimeout();
  assert.doesNotThrow(() => abort.clearTimeout());
});
