/**
 * Unit tests for src/lib/subscription-plans.ts
 * Uses Node.js built-in test runner (node:test + node:assert/strict).
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PLAN_DEFINITIONS, PLAN_MARKETING, getStripePriceId, stripeIsConfigured } from "../lib/subscription-plans.js";

// ─── Plan definitions ─────────────────────────────────────────────────────────

describe("PLAN_DEFINITIONS", () => {
  test("contains free, pro, and business plans", () => {
    assert.ok("free" in PLAN_DEFINITIONS);
    assert.ok("pro" in PLAN_DEFINITIONS);
    assert.ok("business" in PLAN_DEFINITIONS);
  });

  test("free plan has zero price", () => {
    assert.equal(PLAN_DEFINITIONS.free.monthlyPriceCents, 0);
  });

  test("pro plan has a positive price", () => {
    assert.ok(PLAN_DEFINITIONS.pro.monthlyPriceCents > 0);
  });

  test("business plan costs more than pro", () => {
    assert.ok(
      PLAN_DEFINITIONS.business.monthlyPriceCents > PLAN_DEFINITIONS.pro.monthlyPriceCents,
    );
  });

  test("free plan has scan limit of 10", () => {
    assert.equal(PLAN_DEFINITIONS.free.limits.document_scan, 10);
  });

  test("pro plan has a higher scan limit than free", () => {
    const free = PLAN_DEFINITIONS.free.limits.document_scan!;
    const pro  = PLAN_DEFINITIONS.pro.limits.document_scan!;
    assert.ok(pro > free);
  });

  test("business plan has unlimited (null) scan limit", () => {
    assert.equal(PLAN_DEFINITIONS.business.limits.document_scan, null);
  });

  test("every plan definition has an id field", () => {
    for (const [key, def] of Object.entries(PLAN_DEFINITIONS)) {
      assert.equal(def.id, key);
    }
  });

  test("every plan has a non-empty features array", () => {
    for (const def of Object.values(PLAN_DEFINITIONS)) {
      assert.ok(Array.isArray(def.features) && def.features.length > 0, `Plan ${def.id} missing features`);
    }
  });
});

// ─── Marketing copy ───────────────────────────────────────────────────────────

describe("PLAN_MARKETING", () => {
  test("all plans have non-empty tagline, cta, and features", () => {
    for (const plan of ["free", "pro", "business"] as const) {
      const m = PLAN_MARKETING[plan];
      assert.ok(m.tagline, `${plan} missing tagline`);
      assert.ok(m.cta,     `${plan} missing cta`);
      assert.ok(Array.isArray(m.features) && m.features.length > 0, `${plan} missing features`);
    }
  });

  test("free plan lists notIncluded items", () => {
    const notIncluded = PLAN_MARKETING.free.notIncluded;
    assert.ok(Array.isArray(notIncluded) && notIncluded.length > 0);
  });

  test("pro and business plans do not list notIncluded items", () => {
    for (const plan of ["pro", "business"] as const) {
      const m = PLAN_MARKETING[plan];
      assert.ok(!m.notIncluded || m.notIncluded.length === 0, `${plan} should not list notIncluded`);
    }
  });
});

// ─── getStripePriceId ─────────────────────────────────────────────────────────

describe("getStripePriceId", () => {
  beforeEach(() => {
    delete process.env.STRIPE_PRO_PRICE_ID;
    delete process.env.STRIPE_BUSINESS_PRICE_ID;
  });

  test("returns null for pro when env var is absent", () => {
    assert.equal(getStripePriceId("pro"), null);
  });

  test("returns null for business when env var is absent", () => {
    assert.equal(getStripePriceId("business"), null);
  });

  test("returns env var value for pro when set", () => {
    process.env.STRIPE_PRO_PRICE_ID = "price_test_pro";
    assert.equal(getStripePriceId("pro"), "price_test_pro");
  });

  test("returns env var value for business when set", () => {
    process.env.STRIPE_BUSINESS_PRICE_ID = "price_test_biz";
    assert.equal(getStripePriceId("business"), "price_test_biz");
  });

  test("free plan always returns null", () => {
    assert.equal(getStripePriceId("free"), null);
  });
});

// ─── stripeIsConfigured ───────────────────────────────────────────────────────

describe("stripeIsConfigured", () => {
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRO_PRICE_ID;
    delete process.env.STRIPE_BUSINESS_PRICE_ID;
  });

  test("returns false when all vars are missing", () => {
    assert.equal(stripeIsConfigured(), false);
  });

  test("returns false when only secret key is set", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    assert.equal(stripeIsConfigured(), false);
  });

  test("returns false when secret key + one price ID is set", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    process.env.STRIPE_PRO_PRICE_ID = "price_pro";
    assert.equal(stripeIsConfigured(), false);
  });

  test("returns true when all three vars are set", () => {
    process.env.STRIPE_SECRET_KEY     = "sk_test_abc";
    process.env.STRIPE_PRO_PRICE_ID   = "price_pro";
    process.env.STRIPE_BUSINESS_PRICE_ID = "price_biz";
    assert.equal(stripeIsConfigured(), true);
  });

  test("clean up — resets env vars", () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRO_PRICE_ID;
    delete process.env.STRIPE_BUSINESS_PRICE_ID;
    assert.equal(stripeIsConfigured(), false);
  });
});
