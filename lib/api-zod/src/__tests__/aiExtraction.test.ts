/**
 * Unit tests for ExtractedFieldSchema, ExtractedFieldsSchema,
 * UnknownFieldSchema, InstitutionSchema, and AiExtractionOutputSchema.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ExtractedFieldSchema,
  ExtractedFieldsSchema,
  UnknownFieldSchema,
  InstitutionSchema,
  AiExtractionOutputSchema,
} from "../schemas.js";

// ─── ExtractedFieldSchema ─────────────────────────────────────────────────────

describe("ExtractedFieldSchema", () => {
  describe("valid payloads", () => {
    it("accepts a numeric value with confidence", () => {
      const result = ExtractedFieldSchema.parse({ value: 48216.83, confidence: 95 });
      assert.strictEqual(result.value, 48216.83);
      assert.strictEqual(result.confidence, 95);
    });

    it("accepts a string value (date format)", () => {
      assert.strictEqual(
        ExtractedFieldSchema.parse({ value: "2026-03-15", confidence: 90 }).value,
        "2026-03-15",
      );
    });

    it("accepts null value (field not present in document)", () => {
      assert.strictEqual(
        ExtractedFieldSchema.parse({ value: null, confidence: 0 }).value,
        null,
      );
    });

    it("accepts optional sourceText", () => {
      const result = ExtractedFieldSchema.parse({ value: 6.5, confidence: 88, sourceText: "Rate: 6.5%" });
      assert.strictEqual(result.sourceText, "Rate: 6.5%");
    });

    it("accepts field without sourceText", () => {
      assert.strictEqual(
        ExtractedFieldSchema.parse({ value: 1200, confidence: 70 }).sourceText,
        undefined,
      );
    });

    it("accepts value of 0 (zero balance)", () => {
      assert.strictEqual(ExtractedFieldSchema.parse({ value: 0, confidence: 99 }).value, 0);
    });

    it("accepts negative number (e.g. day change -45.12)", () => {
      assert.strictEqual(
        ExtractedFieldSchema.parse({ value: -45.12, confidence: 85 }).value,
        -45.12,
      );
    });
  });

  describe("invalid payloads", () => {
    it("rejects NaN as value", () => {
      assert.throws(() => ExtractedFieldSchema.parse({ value: NaN, confidence: 90 }));
    });

    it("rejects Infinity as value", () => {
      assert.throws(() => ExtractedFieldSchema.parse({ value: Infinity, confidence: 90 }));
    });

    it("rejects string value exceeding 500 characters", () => {
      assert.throws(() => ExtractedFieldSchema.parse({ value: "x".repeat(501), confidence: 50 }));
    });

    it("rejects missing confidence", () => {
      assert.throws(() => ExtractedFieldSchema.parse({ value: 100 }));
    });

    it("rejects confidence out of range (105)", () => {
      assert.throws(() => ExtractedFieldSchema.parse({ value: 100, confidence: 105 }));
    });

    it("rejects sourceText exceeding 500 characters", () => {
      assert.throws(() =>
        ExtractedFieldSchema.parse({ value: 100, confidence: 80, sourceText: "x".repeat(501) }),
      );
    });

    it("rejects an object as value", () => {
      assert.throws(() => ExtractedFieldSchema.parse({ value: { nested: 1 }, confidence: 80 }));
    });

    it("rejects an array as value", () => {
      assert.throws(() => ExtractedFieldSchema.parse({ value: [1, 2, 3], confidence: 80 }));
    });
  });
});

// ─── ExtractedFieldsSchema ────────────────────────────────────────────────────

describe("ExtractedFieldsSchema", () => {
  it("accepts a valid fields map", () => {
    const fields = {
      currentBalance: { value: 5000, confidence: 95 },
      apy: { value: "4.75", confidence: 88 },
    };
    const result = ExtractedFieldsSchema.parse(fields);
    assert.strictEqual(result.currentBalance?.value, 5000);
  });

  it("accepts an empty fields map", () => {
    assert.deepStrictEqual(ExtractedFieldsSchema.parse({}), {});
  });

  it("rejects a key longer than 100 characters", () => {
    assert.throws(() =>
      ExtractedFieldsSchema.parse({ ["x".repeat(101)]: { value: 1, confidence: 90 } }),
    );
  });

  it("rejects more than 200 fields", () => {
    const fields: Record<string, { value: number; confidence: number }> = {};
    for (let i = 0; i <= 200; i++) {
      fields[`field${i}`] = { value: i, confidence: 90 };
    }
    assert.throws(() => ExtractedFieldsSchema.parse(fields));
  });

  it("rejects a field with an invalid confidence (-5)", () => {
    assert.throws(() =>
      ExtractedFieldsSchema.parse({ balance: { value: 100, confidence: -5 } }),
    );
  });
});

// ─── UnknownFieldSchema ───────────────────────────────────────────────────────

describe("UnknownFieldSchema", () => {
  it("accepts a valid unknown field with numeric value", () => {
    const result = UnknownFieldSchema.parse({ label: "Vested Balance", value: 38000, confidence: 90 });
    assert.strictEqual(result.label, "Vested Balance");
    assert.strictEqual(result.value, 38000);
  });

  it("accepts null value", () => {
    assert.strictEqual(
      UnknownFieldSchema.parse({ label: "Some Field", value: null, confidence: 0 }).value,
      null,
    );
  });

  it("accepts string value", () => {
    assert.strictEqual(
      UnknownFieldSchema.parse({ label: "Notes", value: "see attachment", confidence: 60 }).value,
      "see attachment",
    );
  });

  it("rejects label longer than 200 characters", () => {
    assert.throws(() =>
      UnknownFieldSchema.parse({ label: "x".repeat(201), value: 100, confidence: 80 }),
    );
  });

  it("rejects NaN value", () => {
    assert.throws(() =>
      UnknownFieldSchema.parse({ label: "Amount", value: NaN, confidence: 80 }),
    );
  });

  it("rejects missing label", () => {
    assert.throws(() => UnknownFieldSchema.parse({ value: 100, confidence: 80 }));
  });
});

// ─── InstitutionSchema ────────────────────────────────────────────────────────

describe("InstitutionSchema", () => {
  it("accepts a known institution with all fields", () => {
    const result = InstitutionSchema.parse({
      rawName: "Fidelity NetBenefits",
      normalizedName: "Fidelity",
      isKnownInstitution: true,
    });
    assert.strictEqual(result.isKnownInstitution, true);
    assert.strictEqual(result.normalizedName, "Fidelity");
  });

  it("accepts null rawName (no institution found)", () => {
    assert.strictEqual(
      InstitutionSchema.parse({ rawName: null, isKnownInstitution: false }).rawName,
      null,
    );
  });

  it("accepts institution without normalizedName", () => {
    assert.strictEqual(
      InstitutionSchema.parse({ rawName: "Local CU", isKnownInstitution: false }).normalizedName,
      undefined,
    );
  });

  it("rejects rawName exceeding 200 characters", () => {
    assert.throws(() =>
      InstitutionSchema.parse({ rawName: "x".repeat(201), isKnownInstitution: true }),
    );
  });

  it("rejects missing isKnownInstitution", () => {
    assert.throws(() => InstitutionSchema.parse({ rawName: "Bank" }));
  });

  it("rejects non-boolean isKnownInstitution", () => {
    assert.throws(() =>
      InstitutionSchema.parse({ rawName: "Bank", isKnownInstitution: "yes" }),
    );
  });
});

// ─── AiExtractionOutputSchema ─────────────────────────────────────────────────

describe("AiExtractionOutputSchema", () => {
  const validPayload = {
    docType: "401(k)",
    classificationConfidence: 92,
    institution: { rawName: "Fidelity NetBenefits", isKnownInstitution: true },
    fields: {
      currentBalance: { value: 48216.83, confidence: 95, sourceText: "Total Account Value $48,216.83" },
      employeeContributionRate: { value: 6, confidence: 88 },
    },
    unknownFields: [
      { label: "Vested Balance", value: 38000, confidence: 90 },
    ],
  };

  describe("valid payloads", () => {
    it("accepts a complete valid extraction payload", () => {
      const result = AiExtractionOutputSchema.parse(validPayload);
      assert.strictEqual(result.docType, "401(k)");
      assert.strictEqual(result.classificationConfidence, 92);
      assert.strictEqual(result.fields.currentBalance?.value, 48216.83);
      assert.strictEqual(result.unknownFields[0]?.label, "Vested Balance");
    });

    it("applies default classificationConfidence of 0 when absent", () => {
      const { classificationConfidence: _cc, ...noConf } = validPayload;
      assert.strictEqual(AiExtractionOutputSchema.parse(noConf).classificationConfidence, 0);
    });

    it("applies default empty fields map when absent", () => {
      const { fields: _f, ...noFields } = validPayload;
      assert.deepStrictEqual(AiExtractionOutputSchema.parse(noFields).fields, {});
    });

    it("applies default empty unknownFields array when absent", () => {
      const { unknownFields: _u, ...noUnknown } = validPayload;
      assert.deepStrictEqual(AiExtractionOutputSchema.parse(noUnknown).unknownFields, []);
    });

    it("coerces unrecognized docType to Unknown", () => {
      const result = AiExtractionOutputSchema.parse({ ...validPayload, docType: "CryptoBag" });
      assert.strictEqual(result.docType, "Unknown");
    });

    it("accepts Paystub with minimal fields", () => {
      const paystub = {
        docType: "Paystub",
        classificationConfidence: 88,
        fields: { netPay: { value: 2449.87, confidence: 97 } },
        unknownFields: [],
      };
      const result = AiExtractionOutputSchema.parse(paystub);
      assert.strictEqual(result.docType, "Paystub");
      assert.strictEqual(result.fields.netPay?.value, 2449.87);
    });

    it('accepts "Unknown" docType explicitly', () => {
      const result = AiExtractionOutputSchema.parse({ ...validPayload, docType: "Unknown" });
      assert.strictEqual(result.docType, "Unknown");
    });

    it("strips extra top-level keys from AI output", () => {
      const withExtra = { ...validPayload, parseError: false, someExtraKey: "ignored" };
      const result = AiExtractionOutputSchema.parse(withExtra);
      assert.strictEqual((result as Record<string, unknown>).someExtraKey, undefined);
    });
  });

  describe("invalid payloads", () => {
    it("rejects NaN in classificationConfidence", () => {
      assert.throws(() =>
        AiExtractionOutputSchema.parse({ ...validPayload, classificationConfidence: NaN }),
      );
    });

    it("rejects Infinity in classificationConfidence", () => {
      assert.throws(() =>
        AiExtractionOutputSchema.parse({ ...validPayload, classificationConfidence: Infinity }),
      );
    });

    it("rejects NaN inside a field value", () => {
      assert.throws(() =>
        AiExtractionOutputSchema.parse({
          ...validPayload,
          fields: { balance: { value: NaN, confidence: 90 } },
        }),
      );
    });

    it("rejects a field confidence above 100", () => {
      assert.throws(() =>
        AiExtractionOutputSchema.parse({
          ...validPayload,
          fields: { balance: { value: 100, confidence: 150 } },
        }),
      );
    });

    it("rejects more than 50 unknown fields", () => {
      const manyUnknown = Array.from({ length: 51 }, (_, i) => ({
        label: `Field ${i}`,
        value: i,
        confidence: 80,
      }));
      assert.throws(() =>
        AiExtractionOutputSchema.parse({ ...validPayload, unknownFields: manyUnknown }),
      );
    });

    it("rejects a non-object input (string)", () => {
      assert.throws(() => AiExtractionOutputSchema.parse("not an object"));
    });

    it("rejects null", () => {
      assert.throws(() => AiExtractionOutputSchema.parse(null));
    });

    it("rejects an array", () => {
      assert.throws(() => AiExtractionOutputSchema.parse([validPayload]));
    });

    it("includes the field path in error issues for NaN confidence", () => {
      const result = AiExtractionOutputSchema.safeParse({
        ...validPayload,
        classificationConfidence: NaN,
      });
      assert.strictEqual(result.success, false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join("."));
        assert.ok(
          paths.some((p) => p.includes("classificationConfidence")),
          `Expected path to include classificationConfidence, got: ${JSON.stringify(paths)}`,
        );
      }
    });
  });
});
