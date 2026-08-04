import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { securityHeaders } from "../middlewares/security-headers.js";

function makeResponse() {
  const headers = new Map<string, string>();
  return {
    headers,
    response: {
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
      },
      removeHeader(name: string) {
        headers.delete(name.toLowerCase());
      },
    } as unknown as Response,
  };
}

test("sets baseline security headers and calls next", () => {
  const { headers, response } = makeResponse();
  let nextCalled = false;

  securityHeaders({} as Request, response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(headers.get("referrer-policy"), "no-referrer");
  assert.equal(headers.get("cross-origin-resource-policy"), "same-site");
  assert.match(headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.match(headers.get("permissions-policy") ?? "", /camera=\(\)/);
});

test("adds HSTS only in production", () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  try {
    const { headers, response } = makeResponse();
    securityHeaders({} as Request, response, () => undefined);
    assert.equal(
      headers.get("strict-transport-security"),
      "max-age=31536000; includeSubDomains; preload",
    );
  } finally {
    process.env.NODE_ENV = original;
  }
});
