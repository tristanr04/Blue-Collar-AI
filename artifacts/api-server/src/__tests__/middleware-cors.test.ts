/**
 * Tests for the CORS middleware (src/middlewares/cors.ts).
 *
 * Tests buildCorsOptions() in isolation (no HTTP server needed) by calling
 * the origin callback directly, which is the heart of the CORS logic.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isOriginAllowed, buildCorsOptions } from "../middlewares/cors.js";

// ─── isOriginAllowed ──────────────────────────────────────────────────────────

test("isOriginAllowed — dev: allows localhost without port", () => {
  assert.equal(isOriginAllowed("http://localhost", true, []), true);
});

test("isOriginAllowed — dev: allows localhost with port", () => {
  assert.equal(isOriginAllowed("http://localhost:5173", true, []), true);
});

test("isOriginAllowed — dev: allows https localhost", () => {
  assert.equal(isOriginAllowed("https://localhost:3000", true, []), true);
});

test("isOriginAllowed — dev: allows 127.0.0.1", () => {
  assert.equal(isOriginAllowed("http://127.0.0.1:4000", true, []), true);
});

test("isOriginAllowed — dev: allows *.replit.dev subdomain", () => {
  assert.equal(isOriginAllowed("https://abc123.replit.dev", true, []), true);
});

test("isOriginAllowed — dev: allows *.replit.app subdomain", () => {
  assert.equal(isOriginAllowed("https://my-app.replit.app", true, []), true);
});

test("isOriginAllowed — dev: rejects arbitrary external origin", () => {
  assert.equal(isOriginAllowed("https://evil.com", true, []), false);
});

test("isOriginAllowed — dev: rejects origin that only contains replit.dev as substring", () => {
  // Must end with .replit.dev — not just contain it
  assert.equal(isOriginAllowed("https://evil.replit.dev.attacker.com", true, []), false);
});

test("isOriginAllowed — prod: allows listed origin", () => {
  assert.equal(isOriginAllowed("https://myapp.replit.app", false, ["https://myapp.replit.app"]), true);
});

test("isOriginAllowed — prod: rejects unlisted origin", () => {
  assert.equal(isOriginAllowed("https://evil.com", false, ["https://myapp.replit.app"]), false);
});

test("isOriginAllowed — prod: rejects localhost (not in list)", () => {
  assert.equal(isOriginAllowed("http://localhost:5173", false, ["https://myapp.replit.app"]), false);
});

test("isOriginAllowed — prod: empty allowedOrigins blocks everything", () => {
  assert.equal(isOriginAllowed("https://anything.com", false, []), false);
});

// ─── buildCorsOptions origin callback ────────────────────────────────────────

function callOrigin(
  options: ReturnType<typeof buildCorsOptions>,
  origin: string | undefined,
): Promise<{ allowed: boolean; error: Error | null }> {
  return new Promise((resolve) => {
    const cb = options.origin as (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => void;
    cb(origin, (err, allow) => resolve({ allowed: allow === true, error: err }));
  });
}

test("buildCorsOptions — no Origin header (same-origin / curl) is always allowed", async () => {
  const opts = buildCorsOptions({ isDev: false, allowedOrigins: [] });
  const result = await callOrigin(opts, undefined);
  assert.equal(result.allowed, true);
  assert.equal(result.error, null);
});

test("buildCorsOptions — dev mode allows localhost", async () => {
  const opts = buildCorsOptions({ isDev: true });
  const result = await callOrigin(opts, "http://localhost:5173");
  assert.equal(result.allowed, true);
});

test("buildCorsOptions — dev mode rejects external origin", async () => {
  const opts = buildCorsOptions({ isDev: true });
  const result = await callOrigin(opts, "https://malicious.com");
  assert.equal(result.allowed, false);
});

test("buildCorsOptions — prod allows explicitly listed origin", async () => {
  const opts = buildCorsOptions({
    isDev: false,
    allowedOrigins: ["https://blue-collar-ai.replit.app"],
  });
  const result = await callOrigin(opts, "https://blue-collar-ai.replit.app");
  assert.equal(result.allowed, true);
});

test("buildCorsOptions — prod rejects origin not in list", async () => {
  const opts = buildCorsOptions({
    isDev: false,
    allowedOrigins: ["https://blue-collar-ai.replit.app"],
  });
  const result = await callOrigin(opts, "https://attacker.com");
  assert.equal(result.allowed, false);
  assert.equal(result.error, null); // callback(null, false) — no error thrown
});

test("buildCorsOptions — prod with empty ALLOWED_ORIGINS blocks all origins", async () => {
  const opts = buildCorsOptions({ isDev: false, allowedOrigins: [] });
  const result = await callOrigin(opts, "https://anything.com");
  assert.equal(result.allowed, false);
});
