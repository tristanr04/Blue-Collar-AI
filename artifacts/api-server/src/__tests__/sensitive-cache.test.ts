import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { sensitiveResponseNoStore } from "../middlewares/sensitive-cache.js";

function run(path: string) {
  const headers = new Map<string, string>();
  let nextCalled = false;

  const req = {
    originalUrl: path,
    path: path.split("?", 1)[0],
  } as Request;

  const res = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
  } as unknown as Response;

  const next = (() => {
    nextCalled = true;
  }) as NextFunction;

  sensitiveResponseNoStore(req, res, next);
  return { headers, nextCalled };
}

for (const path of [
  "/api/financial/snapshot",
  "/api/migrate/status/job-123",
  "/api/scan-document",
  "/api/ai/ask",
  "/api/capabilities",
]) {
  test(`marks ${path} as non-cacheable`, () => {
    const { headers, nextCalled } = run(path);
    assert.equal(nextCalled, true);
    assert.match(headers.get("cache-control") ?? "", /private/);
    assert.match(headers.get("cache-control") ?? "", /no-store/);
    assert.equal(headers.get("pragma"), "no-cache");
    assert.equal(headers.get("expires"), "0");
    assert.equal(headers.get("surrogate-control"), "no-store");
  });
}

test("matches sensitive paths with query strings", () => {
  const { headers } = run("/api/financial/snapshot?refresh=true");
  assert.match(headers.get("cache-control") ?? "", /no-store/);
});

test("does not disable caching for unrelated routes", () => {
  const { headers, nextCalled } = run("/api/health");
  assert.equal(nextCalled, true);
  assert.equal(headers.size, 0);
});

test("does not match similarly named non-sensitive routes", () => {
  const { headers } = run("/api/financially-related");
  assert.equal(headers.size, 0);
});
