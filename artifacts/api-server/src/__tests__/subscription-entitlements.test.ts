/**
 * Unit tests for src/lib/entitlements.ts
 * Covers: isAccessActive, resolveEffectivePlan, checkEntitlement, currentPeriodKey.
 *
 * Uses Node.js built-in test runner (node:test + node:assert/strict).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkEntitlement,
  resolveEffectivePlan,
  isAccessActive,
  currentPeriodKey,
  PLAN_DEFINITIONS,
} from "../lib/entitlements.js";

// ─── isAccessActive ───────────────────────────────────────────────────────────

describe("isAccessActive", () => {
  test("active returns true", () => {
    assert.equal(isAccessActive("active"), true);
  });

  test("trialing with future expiry returns true", () => {
    const future = new Date(Date.now() + 86_400_000);
    assert.equal(isAccessActive("trialing", future), true);
  });

  test("trialing with past expiry returns false", () => {
    const past = new Date(Date.now() - 86_400_000);
    assert.equal(isAccessActive("trialing", past), false);
  });

  test("trialing without expiry returns true (unset expiry is treated as active)", () => {
    // When no trialEndsAt is provided the subscription is considered active
    // — the caller must provide an explicit past date to revoke access.
    assert.equal(isAccessActive("trialing", null), true);
  });

  test("past_due returns false", () => {
    assert.equal(isAccessActive("past_due"), false);
  });

  test("canceled returns false", () => {
    assert.equal(isAccessActive("canceled"), false);
  });

  test("unpaid returns false", () => {
    assert.equal(isAccessActive("unpaid"), false);
  });

  test("incomplete returns false", () => {
    assert.equal(isAccessActive("incomplete"), false);
  });
});

// ─── resolveEffectivePlan ─────────────────────────────────────────────────────

describe("resolveEffectivePlan", () => {
  test("free plan resolves to free regardless of status", () => {
    assert.equal(resolveEffectivePlan({ plan: "free", status: "active" }), "free");
  });

  test("pro + active → pro", () => {
    assert.equal(resolveEffectivePlan({ plan: "pro", status: "active" }), "pro");
  });

  test("pro + past_due → free (access revoked)", () => {
    assert.equal(resolveEffectivePlan({ plan: "pro", status: "past_due" }), "free");
  });

  test("pro + unpaid → free", () => {
    assert.equal(resolveEffectivePlan({ plan: "pro", status: "unpaid" }), "free");
  });

  test("pro + canceled → free", () => {
    assert.equal(resolveEffectivePlan({ plan: "pro", status: "canceled" }), "free");
  });

  test("business + active → business", () => {
    assert.equal(resolveEffectivePlan({ plan: "business", status: "active" }), "business");
  });

  test("business + canceled → free", () => {
    assert.equal(resolveEffectivePlan({ plan: "business", status: "canceled" }), "free");
  });

  test("null plan defaults to free", () => {
    assert.equal(resolveEffectivePlan({ plan: null, status: "active" }), "free");
  });

  test("undefined plan defaults to free", () => {
    assert.equal(resolveEffectivePlan({ plan: undefined as never, status: "active" }), "free");
  });
});

// ─── checkEntitlement — free plan ────────────────────────────────────────────

describe("checkEntitlement — free plan document_scan", () => {
  const limit = PLAN_DEFINITIONS.free.limits.document_scan as number; // 10

  test("allows scan when usage is below limit", () => {
    const r = checkEntitlement({ plan: "free", feature: "document_scan", used: 5 });
    assert.equal(r.allowed, true);
    assert.equal(r.remaining, 5);
  });

  test("allows scan on the last available slot (used = limit - 1)", () => {
    const r = checkEntitlement({ plan: "free", feature: "document_scan", used: limit - 1 });
    assert.equal(r.allowed, true);
    assert.equal(r.remaining, 1);
  });

  test("blocks scan when limit is exactly met (used = limit)", () => {
    const r = checkEntitlement({ plan: "free", feature: "document_scan", used: limit });
    assert.equal(r.allowed, false);
    assert.equal(r.remaining, 0);
    assert.equal(r.upgradeRequired, true);
  });

  test("blocks scan when usage exceeds limit", () => {
    const r = checkEntitlement({ plan: "free", feature: "document_scan", used: limit + 5 });
    assert.equal(r.allowed, false);
  });

  test("reports the correct limit on the result", () => {
    const r = checkEntitlement({ plan: "free", feature: "document_scan", used: 0 });
    assert.equal(r.limit, limit);
  });
});

// ─── checkEntitlement — pro plan ─────────────────────────────────────────────

describe("checkEntitlement — pro plan document_scan", () => {
  const limit = PLAN_DEFINITIONS.pro.limits.document_scan as number; // 150

  test("allows scan at high usage below pro limit", () => {
    const r = checkEntitlement({ plan: "pro", feature: "document_scan", used: 100 });
    assert.equal(r.allowed, true);
  });

  test("blocks scan at exactly the pro limit (used = limit)", () => {
    const r = checkEntitlement({ plan: "pro", feature: "document_scan", used: limit });
    assert.equal(r.allowed, false);
  });

  test("pro limit is higher than free limit", () => {
    const freeLimit = PLAN_DEFINITIONS.free.limits.document_scan!;
    assert.ok(limit > freeLimit);
  });
});

// ─── checkEntitlement — business (unlimited) ─────────────────────────────────

describe("checkEntitlement — business (unlimited)", () => {
  test("always allows document_scan regardless of usage", () => {
    const r = checkEntitlement({ plan: "business", feature: "document_scan", used: 99999 });
    assert.equal(r.allowed, true);
    assert.equal(r.limit, null);
    assert.equal(r.remaining, null);
  });

  test("always allows ai_question for business", () => {
    const r = checkEntitlement({ plan: "business", feature: "ai_question", used: 99999 });
    assert.equal(r.allowed, true);
  });

  test("upgradeRequired is false when allowed", () => {
    const r = checkEntitlement({ plan: "business", feature: "document_scan", used: 99999 });
    assert.equal(r.upgradeRequired, false);
  });
});

// ─── checkEntitlement — requested quantity ────────────────────────────────────

describe("checkEntitlement — requested quantity", () => {
  test("accounts for requested > 1 when checking against limit", () => {
    // used: 9, requesting: 2, limit: 10 → would consume 11 → denied
    const r = checkEntitlement({ plan: "free", feature: "document_scan", used: 9, requested: 2 });
    assert.equal(r.allowed, false);
  });

  test("allows when requested fits exactly within remaining capacity", () => {
    const r = checkEntitlement({ plan: "free", feature: "document_scan", used: 8, requested: 2 });
    assert.equal(r.allowed, true);
  });

  test("defaults to requested=1 when not specified", () => {
    const a = checkEntitlement({ plan: "free", feature: "document_scan", used: 9 });
    const b = checkEntitlement({ plan: "free", feature: "document_scan", used: 9, requested: 1 });
    assert.equal(a.allowed, b.allowed);
  });
});

// ─── currentPeriodKey ─────────────────────────────────────────────────────────

describe("currentPeriodKey", () => {
  test("returns YYYY-MM formatted string", () => {
    const key = currentPeriodKey();
    assert.match(key, /^\d{4}-\d{2}$/);
  });

  test("returns the current UTC month", () => {
    const now = new Date();
    const expected = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    assert.equal(currentPeriodKey(), expected);
  });

  test("accepts a custom date — March 2025", () => {
    assert.equal(currentPeriodKey(new Date("2025-03-15T00:00:00Z")), "2025-03");
  });

  test("handles December correctly", () => {
    assert.equal(currentPeriodKey(new Date("2025-12-01T00:00:00Z")), "2025-12");
  });

  test("handles January correctly", () => {
    assert.equal(currentPeriodKey(new Date("2026-01-31T23:59:59Z")), "2026-01");
  });
});
