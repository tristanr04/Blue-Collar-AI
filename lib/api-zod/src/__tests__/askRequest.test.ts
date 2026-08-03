/**
 * Unit tests for AskRequestSchema and FinancialProfileSchema.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AskRequestSchema, FinancialProfileSchema } from "../schemas.js";

// ─── AskRequestSchema ─────────────────────────────────────────────────────────

describe("AskRequestSchema", () => {
  describe("valid requests", () => {
    it("accepts a minimal valid request (question only)", () => {
      const result = AskRequestSchema.parse({ question: "What is my net worth?" });
      assert.strictEqual(result.question, "What is my net worth?");
      assert.strictEqual(result.financialProfile, undefined);
    });

    it("accepts a request with financialProfile", () => {
      const result = AskRequestSchema.parse({
        question: "How much overtime do I need?",
        financialProfile: { assets: [], debts: [], paystubs: [] },
      });
      assert.strictEqual(result.question, "How much overtime do I need?");
      assert.notStrictEqual(result.financialProfile, undefined);
    });

    it("accepts a question exactly 2,000 characters long", () => {
      const q = "a".repeat(2000);
      assert.strictEqual(AskRequestSchema.parse({ question: q }).question.length, 2000);
    });

    it("trims leading and trailing whitespace from question", () => {
      assert.strictEqual(
        AskRequestSchema.parse({ question: "  Hello?  " }).question,
        "Hello?",
      );
    });

    it("accepts a question with unicode characters", () => {
      assert.strictEqual(
        AskRequestSchema.parse({ question: "¿Cuánto debo?" }).question,
        "¿Cuánto debo?",
      );
    });

    it("accepts omitted financialProfile", () => {
      assert.strictEqual(AskRequestSchema.parse({ question: "Hello?" }).financialProfile, undefined);
    });
  });

  describe("invalid requests", () => {
    it("rejects missing question field", () => {
      assert.throws(() => AskRequestSchema.parse({}));
    });

    it("rejects empty string question", () => {
      assert.throws(() => AskRequestSchema.parse({ question: "" }));
    });

    it("rejects whitespace-only question (trims to empty)", () => {
      assert.throws(() => AskRequestSchema.parse({ question: "   " }));
    });

    it("rejects question longer than 2,000 characters", () => {
      assert.throws(() => AskRequestSchema.parse({ question: "a".repeat(2001) }));
    });

    it("rejects numeric question", () => {
      assert.throws(() => AskRequestSchema.parse({ question: 42 }));
    });

    it("rejects null question", () => {
      assert.throws(() => AskRequestSchema.parse({ question: null }));
    });

    it("includes '2,000' in the error message for question > 2000 chars", () => {
      const result = AskRequestSchema.safeParse({ question: "a".repeat(2001) });
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const msg = result.error.issues[0]?.message ?? "";
        assert.ok(msg.includes("2,000"), `Expected message to include "2,000", got: ${msg}`);
      }
    });

    it("includes 'empty' in the error message for an empty question", () => {
      const result = AskRequestSchema.safeParse({ question: "" });
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const allMessages = result.error.issues.map((i) => i.message).join(" ");
        assert.ok(/empty/i.test(allMessages), `Expected "empty" in messages, got: ${allMessages}`);
      }
    });
  });
});

// ─── FinancialProfileSchema ───────────────────────────────────────────────────

describe("FinancialProfileSchema", () => {
  describe("valid profiles", () => {
    it("accepts a typical financial profile object", () => {
      const profile = {
        assets: [{ id: "a1", name: "Checking", value: 5000 }],
        debts: [],
        bills: [],
        paystubs: [],
      };
      assert.deepStrictEqual(FinancialProfileSchema.parse(profile), profile);
    });

    it("accepts an empty object", () => {
      assert.deepStrictEqual(FinancialProfileSchema.parse({}), {});
    });

    it("accepts an object nested exactly 10 levels deep (at limit)", () => {
      function nest(depth: number): Record<string, unknown> {
        if (depth === 0) return { leaf: true };
        return { child: nest(depth - 1) };
      }
      // depth=10 produces root → child × 9 → leaf = 10 levels total
      assert.doesNotThrow(() => FinancialProfileSchema.parse(nest(9)));
    });

    it("accepts objects with numeric and string values", () => {
      const profile = { netWorth: 25000, savingsRate: 0.12, name: "Test" };
      assert.deepStrictEqual(FinancialProfileSchema.parse(profile), profile);
    });

    it("accepts a profile close to but under the 100 KB limit", () => {
      const profile = { data: "x".repeat(98_000) };
      assert.doesNotThrow(() => FinancialProfileSchema.parse(profile));
    });
  });

  describe("invalid profiles — wrong type", () => {
    it("rejects an array", () => {
      assert.throws(() => FinancialProfileSchema.parse([{ name: "asset" }]));
    });

    it("rejects a string", () => {
      assert.throws(() => FinancialProfileSchema.parse("{}"));
    });

    it("rejects a number", () => {
      assert.throws(() => FinancialProfileSchema.parse(42));
    });

    it("rejects null", () => {
      assert.throws(() => FinancialProfileSchema.parse(null));
    });

    it("includes 'object' in the error message for array input", () => {
      const result = FinancialProfileSchema.safeParse([]);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const allMessages = result.error.issues.map((i) => i.message).join(" ");
        assert.ok(
          /object/i.test(allMessages),
          `Expected "object" in messages, got: ${allMessages}`,
        );
      }
    });
  });

  describe("invalid profiles — size limit (100 KB)", () => {
    it("rejects a profile that exceeds 100 KB serialized", () => {
      // JSON.stringify adds key + quotes overhead, so the string payload alone > 100 KB
      const bigProfile = { data: "x".repeat(100_001) };
      assert.throws(() => FinancialProfileSchema.parse(bigProfile));
    });

    it("includes '100 KB' or 'size limit' in the error message", () => {
      const bigProfile = { data: "x".repeat(100_001) };
      const result = FinancialProfileSchema.safeParse(bigProfile);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const allMessages = result.error.issues.map((i) => i.message).join(" ");
        assert.ok(
          /100 KB/i.test(allMessages) || /size limit/i.test(allMessages),
          `Expected size-limit message, got: ${allMessages}`,
        );
      }
    });
  });

  describe("invalid profiles — nesting depth (> 10)", () => {
    it("rejects a profile nested 11 levels deep", () => {
      function deepNest(depth: number): Record<string, unknown> {
        if (depth === 0) return { value: "bottom" };
        return { nested: deepNest(depth - 1) };
      }
      // depth=11 produces 11 levels of nesting — one over the limit
      assert.throws(() => FinancialProfileSchema.parse(deepNest(11)));
    });

    it("includes 'depth' or 'nesting' in the error message", () => {
      function deepNest(depth: number): Record<string, unknown> {
        if (depth === 0) return { value: "bottom" };
        return { nested: deepNest(depth - 1) };
      }
      const result = FinancialProfileSchema.safeParse(deepNest(11));
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const allMessages = result.error.issues.map((i) => i.message).join(" ");
        assert.ok(
          /depth|nesting/i.test(allMessages),
          `Expected depth/nesting message, got: ${allMessages}`,
        );
      }
    });
  });
});
