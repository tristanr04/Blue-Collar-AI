/**
 * Unit tests for ConfidenceSchema and DocTypeSchema.
 * Uses Node.js built-in test runner (node:test) — no external framework needed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConfidenceSchema, DocTypeSchema, KNOWN_DOC_TYPES } from "../schemas.js";

// ─── ConfidenceSchema ─────────────────────────────────────────────────────────

describe("ConfidenceSchema", () => {
  describe("valid values", () => {
    it("accepts 0 (minimum boundary)", () => {
      assert.strictEqual(ConfidenceSchema.parse(0), 0);
    });

    it("accepts 100 (maximum boundary)", () => {
      assert.strictEqual(ConfidenceSchema.parse(100), 100);
    });

    it("accepts mid-range integer 75", () => {
      assert.strictEqual(ConfidenceSchema.parse(75), 75);
    });

    it("accepts fractional value 92.5", () => {
      assert.strictEqual(ConfidenceSchema.parse(92.5), 92.5);
    });

    it("accepts 0.1 (near-minimum decimal)", () => {
      assert.strictEqual(ConfidenceSchema.parse(0.1), 0.1);
    });

    it("accepts 99.99 (near-maximum decimal)", () => {
      assert.strictEqual(ConfidenceSchema.parse(99.99), 99.99);
    });
  });

  describe("invalid values", () => {
    it("rejects -1 (below minimum)", () => {
      assert.throws(() => ConfidenceSchema.parse(-1));
    });

    it("rejects 101 (above maximum)", () => {
      assert.throws(() => ConfidenceSchema.parse(101));
    });

    it("rejects NaN", () => {
      assert.throws(() => ConfidenceSchema.parse(NaN));
    });

    it("rejects Infinity", () => {
      assert.throws(() => ConfidenceSchema.parse(Infinity));
    });

    it("rejects -Infinity", () => {
      assert.throws(() => ConfidenceSchema.parse(-Infinity));
    });

    it("rejects string '90'", () => {
      assert.throws(() => ConfidenceSchema.parse("90"));
    });

    it("rejects boolean true", () => {
      assert.throws(() => ConfidenceSchema.parse(true));
    });

    it("rejects null", () => {
      assert.throws(() => ConfidenceSchema.parse(null));
    });

    it("rejects undefined", () => {
      assert.throws(() => ConfidenceSchema.parse(undefined));
    });

    it("rejects an object", () => {
      assert.throws(() => ConfidenceSchema.parse({ value: 90 }));
    });

    it("rejects NaN with a non-empty error message", () => {
      // Zod treats NaN as an invalid type (not a valid number) so the
      // invalid_type_error fires before .finite() is reached. We verify
      // the parse fails and at least one issue is reported.
      const result = ConfidenceSchema.safeParse(NaN);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(result.error.issues.length > 0, "Expected at least one validation issue");
        const msg = result.error.issues[0]?.message ?? "";
        assert.ok(msg.length > 0, `Expected a non-empty error message, got: ${JSON.stringify(msg)}`);
      }
    });

    it("includes '100' in the error message for 101", () => {
      const result = ConfidenceSchema.safeParse(101);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const msg = result.error.issues[0]?.message ?? "";
        assert.ok(msg.includes("100"), `Expected message to include "100", got: ${msg}`);
      }
    });
  });
});

// ─── DocTypeSchema ────────────────────────────────────────────────────────────

describe("DocTypeSchema", () => {
  describe("known document types pass through unchanged", () => {
    for (const docType of ["Paystub", "Checking Account", "401(k)", "Roth 401(k)", "Monthly Bill", "Unknown"] as const) {
      it(`accepts "${docType}"`, () => {
        assert.strictEqual(DocTypeSchema.parse(docType), docType);
      });
    }

    it("accepts every type in KNOWN_DOC_TYPES", () => {
      for (const dt of KNOWN_DOC_TYPES) {
        const result = DocTypeSchema.parse(dt);
        assert.strictEqual(result, dt, `Expected "${dt}" to pass through unchanged`);
      }
    });
  });

  describe("unknown types resolve to 'Unknown'", () => {
    const unknownInputs = [
      "GiftCard",
      "FakeBankStatement",
      "investment account",   // wrong casing
      "401k",                  // missing parens
      "crypto wallet",
      "",
      "   ",
    ];

    for (const val of unknownInputs) {
      it(`coerces "${val}" → "Unknown"`, () => {
        assert.strictEqual(DocTypeSchema.parse(val), "Unknown");
      });
    }

    it("coerces an unrecognized AI-invented type to Unknown", () => {
      assert.strictEqual(DocTypeSchema.parse("Cryptocurrency Exchange"), "Unknown");
    });
  });

  describe("invalid types (non-string)", () => {
    it("rejects number 42", () => {
      assert.throws(() => DocTypeSchema.parse(42));
    });

    it("rejects null", () => {
      assert.throws(() => DocTypeSchema.parse(null));
    });

    it("rejects undefined", () => {
      assert.throws(() => DocTypeSchema.parse(undefined));
    });

    it("rejects a string longer than 100 characters", () => {
      assert.throws(() => DocTypeSchema.parse("x".repeat(101)));
    });
  });
});
