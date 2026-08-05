/**
 * Tests for the scan-result classification system:
 *   - classifyContentResult: semantic content detection (multiple docs, unsupported, low confidence)
 *   - mapFailureCauseToResult: FailureCause → result code + message + retryable flag
 *   - buildDiagnosticFailureBody: specific messages, result codes, retryable included
 *   - retryable flags on every error path
 *   - batch isolation: one failure doesn't affect others
 *   - no sensitive details in frontend-visible error fields
 *
 * Uses mocked provider responses where appropriate so tests are deterministic.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  classifyContentResult,
  buildDiagnosticFailureBody,
} from "../routes/scan.js";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const mockMeta = {
  model: "gpt-test",
  finishReason: "stop" as const,
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
  promptChars: 0,
  responseChars: 300,
};

function makeDiag(cause: string, detail = "test detail") {
  return {
    cause: cause as any,
    detail,
    rawHead: "not-in-response",
    rawTail: "not-in-response",
  };
}

// ─── classifyContentResult ────────────────────────────────────────────────────

describe("classifyContentResult", () => {

  // ── Multiple documents ────────────────────────────────────────────────────

  test("returns MULTIPLE_DOCUMENTS_DETECTED for docType='Multiple Documents'", () => {
    const r = classifyContentResult({
      docType: "Multiple Documents",
      classificationConfidence: 85,
    });
    assert.ok(r !== null);
    assert.equal(r.code, "MULTIPLE_DOCUMENTS_DETECTED");
    assert.equal(r.retryable, false);
    assert.ok(r.message.includes("multiple documents"), "message mentions multiple documents");
    assert.ok(r.message.includes("separately"), "message says to upload separately");
    assert.equal(r.status, 422);
  });

  test("returns MULTIPLE_DOCUMENTS_DETECTED for docType='Multiple Documents' (case variation)", () => {
    const r = classifyContentResult({
      docType: "multiple documents",
      classificationConfidence: 70,
    });
    assert.ok(r !== null);
    assert.equal(r.code, "MULTIPLE_DOCUMENTS_DETECTED");
    assert.equal(r.retryable, false);
  });

  test("returns MULTIPLE_DOCUMENTS_DETECTED for docType with leading/trailing whitespace", () => {
    const r = classifyContentResult({
      docType: "  Multiple Documents  ",
      classificationConfidence: 60,
    });
    assert.ok(r !== null);
    assert.equal(r.code, "MULTIPLE_DOCUMENTS_DETECTED");
  });

  // ── Unsupported document ──────────────────────────────────────────────────

  test("returns UNSUPPORTED_DOCUMENT for docType='Unknown' with null confidence", () => {
    const r = classifyContentResult({ docType: "Unknown" });
    assert.ok(r !== null);
    assert.equal(r.code, "UNSUPPORTED_DOCUMENT");
    assert.equal(r.retryable, false);
    assert.ok(r.message.includes("supported financial document"), "message is clear");
  });

  test("returns UNSUPPORTED_DOCUMENT for docType='Unknown' with confidence < 40", () => {
    const r = classifyContentResult({
      docType: "Unknown",
      classificationConfidence: 25,
    });
    assert.ok(r !== null);
    assert.equal(r.code, "UNSUPPORTED_DOCUMENT");
    assert.equal(r.retryable, false);
  });

  test("returns null (allow through) for docType='Unknown' with confidence=40 exactly", () => {
    // Exactly at the threshold — marginal but allowed through to Zod validation
    const r = classifyContentResult({
      docType: "Unknown",
      classificationConfidence: 40,
    });
    assert.equal(r, null);
  });

  test("returns null for docType='Unknown' with confidence > 40 (AI is confident it's unknown)", () => {
    // High-confidence Unknown is unusual but should be allowed through so
    // Zod validation can run on the fields before rejection.
    const r = classifyContentResult({
      docType: "Unknown",
      classificationConfidence: 75,
    });
    assert.equal(r, null);
  });

  // ── Low confidence ────────────────────────────────────────────────────────

  test("returns LOW_CONFIDENCE for any type with confidence <= 20", () => {
    const r = classifyContentResult({
      docType: "Credit Card",
      classificationConfidence: 15,
    });
    assert.ok(r !== null);
    assert.equal(r.code, "LOW_CONFIDENCE");
    assert.equal(r.retryable, true);
    assert.ok(r.message.includes("clearer image") || r.message.includes("confidently"), "message guides user");
  });

  test("returns LOW_CONFIDENCE for confidence=0", () => {
    const r = classifyContentResult({
      docType: "Paystub",
      classificationConfidence: 0,
    });
    assert.ok(r !== null);
    assert.equal(r.code, "LOW_CONFIDENCE");
    assert.equal(r.retryable, true);
  });

  test("returns LOW_CONFIDENCE for confidence=20 exactly (on-the-threshold)", () => {
    const r = classifyContentResult({
      docType: "Mortgage",
      classificationConfidence: 20,
    });
    assert.ok(r !== null);
    assert.equal(r.code, "LOW_CONFIDENCE");
  });

  test("returns null for confidence=21 (just above threshold)", () => {
    const r = classifyContentResult({
      docType: "Mortgage",
      classificationConfidence: 21,
    });
    assert.equal(r, null);
  });

  test("returns null for supported docType with no confidence field", () => {
    const r = classifyContentResult({ docType: "Credit Card" });
    assert.equal(r, null);
  });

  // ── Normal extraction passthrough ─────────────────────────────────────────

  test("returns null for valid bank statement extraction", () => {
    const r = classifyContentResult({
      docType: "Bank Statement",
      classificationConfidence: 92,
      fields: { currentBalance: { value: 1500, confidence: 90 } },
    });
    assert.equal(r, null);
  });

  test("returns null for valid paystub extraction", () => {
    const r = classifyContentResult({
      docType: "Paystub",
      classificationConfidence: 88,
    });
    assert.equal(r, null);
  });

  test("returns null for valid credit card extraction", () => {
    const r = classifyContentResult({
      docType: "Credit Card",
      classificationConfidence: 95,
    });
    assert.equal(r, null);
  });

  test("returns null for valid auto loan extraction", () => {
    const r = classifyContentResult({
      docType: "Auto Loan",
      classificationConfidence: 91,
    });
    assert.equal(r, null);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  test("returns null for missing docType (empty string)", () => {
    const r = classifyContentResult({ classificationConfidence: 80 });
    assert.equal(r, null);
  });

  test("returns null for non-string docType", () => {
    const r = classifyContentResult({ docType: 42, classificationConfidence: 80 });
    assert.equal(r, null);
  });

  test("does NOT return MULTIPLE_DOCUMENTS_DETECTED for 'Document' (partial match guard)", () => {
    // 'Document' alone must not be confused with 'Multiple Documents'
    const r = classifyContentResult({
      docType: "Document",
      classificationConfidence: 80,
    });
    assert.equal(r, null);
  });

  // ── message safety ────────────────────────────────────────────────────────

  test("all content-classification messages are safe for user display", () => {
    const testCases: Record<string, unknown>[] = [
      { docType: "Multiple Documents", classificationConfidence: 80 },
      { docType: "Unknown" },
      { docType: "Credit Card", classificationConfidence: 10 },
    ];

    for (const input of testCases) {
      const r = classifyContentResult(input);
      if (r === null) continue;
      assert.ok(!r.message.includes("Error:"), `no 'Error:' in "${r.message}"`);
      assert.ok(!r.message.match(/at [A-Za-z].*:\d+/), `no stack trace in "${r.message}"`);
      assert.ok(!r.message.includes("node_modules"), `no node_modules path`);
      assert.ok(!r.message.match(/sk-[A-Za-z0-9]{10,}/), `no API key pattern`);
      assert.ok(r.message.length > 10 && r.message.length < 250, "message length is reasonable");
    }
  });
});

// ─── buildDiagnosticFailureBody — specific messages ──────────────────────────

describe("buildDiagnosticFailureBody — cause-specific messages", () => {

  test("empty_response → UNREADABLE_DOCUMENT, retryable: true", () => {
    const body = buildDiagnosticFailureBody({
      file: "blurry.jpg",
      attempt1: { meta: mockMeta, rawText: "", diagnosis: makeDiag("empty_response") },
      attempt2: null,
      rawExtractionKeys: null,
    });

    assert.equal(body.resultCode, "UNREADABLE_DOCUMENT");
    assert.equal(body.retryable, true);
    assert.ok(
      (body.error as string).includes("blurry") ||
      (body.error as string).includes("unclear") ||
      (body.error as string).includes("read"),
      `message should mention document quality, got: "${body.error}"`,
    );
  });

  test("model_refusal → UNSUPPORTED_DOCUMENT, retryable: false", () => {
    const body = buildDiagnosticFailureBody({
      file: "receipt.jpg",
      attempt1: { meta: mockMeta, rawText: "I'm sorry, I cannot help with that.", diagnosis: makeDiag("model_refusal") },
      attempt2: null,
      rawExtractionKeys: null,
    });

    assert.equal(body.resultCode, "UNSUPPORTED_DOCUMENT");
    assert.equal(body.retryable, false);
    assert.ok(
      (body.error as string).includes("supported") ||
      (body.error as string).includes("identify"),
      `message should indicate unsupported type, got: "${body.error}"`,
    );
  });

  test("truncated_output → INVALID_STRUCTURED_RESPONSE, retryable: true", () => {
    const body = buildDiagnosticFailureBody({
      file: "large.pdf",
      attempt1: {
        meta: { ...mockMeta, finishReason: "length", completionTokens: 2048 },
        rawText: '{"docType": "Credit Card", "field',
        diagnosis: makeDiag("truncated_output"),
      },
      attempt2: null,
      rawExtractionKeys: null,
    });

    assert.equal(body.resultCode, "INVALID_STRUCTURED_RESPONSE");
    assert.equal(body.retryable, true);
  });

  test("invalid_json_syntax → INVALID_STRUCTURED_RESPONSE, retryable: true", () => {
    const body = buildDiagnosticFailureBody({
      file: "bad.jpg",
      attempt1: { meta: mockMeta, rawText: "not json at all", diagnosis: makeDiag("invalid_json_syntax") },
      attempt2: null,
      rawExtractionKeys: null,
    });

    assert.equal(body.resultCode, "INVALID_STRUCTURED_RESPONSE");
    assert.equal(body.retryable, true);
  });

  test("zod_schema_mismatch → INVALID_STRUCTURED_RESPONSE, retryable: true", () => {
    const body = buildDiagnosticFailureBody({
      file: "paystub.jpg",
      attempt1: { meta: mockMeta, rawText: '{"docType": "Paystub"}', diagnosis: makeDiag("zod_schema_mismatch") },
      attempt2: null,
      rawExtractionKeys: ["docType"],
    });

    assert.equal(body.resultCode, "INVALID_STRUCTURED_RESPONSE");
    assert.equal(body.retryable, true);
  });

  test("markdown_wrapping → INVALID_STRUCTURED_RESPONSE, retryable: true", () => {
    const body = buildDiagnosticFailureBody({
      file: "statement.jpg",
      attempt1: { meta: mockMeta, rawText: "```json\n{\"docType\": \"Credit Card\"}\n```", diagnosis: makeDiag("markdown_wrapping") },
      attempt2: null,
      rawExtractionKeys: null,
    });

    assert.equal(body.resultCode, "INVALID_STRUCTURED_RESPONSE");
    assert.equal(body.retryable, true);
  });

  test("on retry path, uses attempt2 cause for result code selection", () => {
    // attempt1: markdown_wrapping (INVALID_STRUCTURED_RESPONSE)
    // attempt2: empty_response (UNREADABLE_DOCUMENT — different code)
    const body = buildDiagnosticFailureBody({
      file: "doc.jpg",
      attempt1: { meta: mockMeta, rawText: "```json{}```", diagnosis: makeDiag("markdown_wrapping") },
      attempt2: { meta: mockMeta, rawText: "", diagnosis: makeDiag("empty_response") },
      rawExtractionKeys: null,
    });

    // Uses attempt2 (the final attempt) for code selection
    assert.equal(body.resultCode, "UNREADABLE_DOCUMENT");
    assert.equal(body.retryable, true);
    // Both attempt causes are still preserved in the diagnostic payload
    assert.equal((body.diagnosis as any).attempt1Cause, "markdown_wrapping");
    assert.equal((body.diagnosis as any).attempt2Cause, "empty_response");
  });

  test("result code is included in the response body (machine-readable)", () => {
    const body = buildDiagnosticFailureBody({
      file: "test.jpg",
      attempt1: { meta: mockMeta, rawText: "", diagnosis: makeDiag("empty_response") },
      attempt2: null,
      rawExtractionKeys: null,
    });

    assert.ok("resultCode" in body, "resultCode key is present");
    assert.ok("retryable" in body, "retryable key is present");
    assert.equal(typeof body.retryable, "boolean");
  });

  // ── No generic "unrecognized response format" message ───────────────────

  test("NONE of the cause mappings produce the old generic message", () => {
    const causes = [
      "empty_response",
      "model_refusal",
      "truncated_output",
      "markdown_wrapping",
      "extra_explanatory_text",
      "multiple_json_objects",
      "invalid_json_syntax",
      "zod_schema_mismatch",
      "unknown",
    ] as const;

    for (const cause of causes) {
      const body = buildDiagnosticFailureBody({
        file: "test.jpg",
        attempt1: { meta: mockMeta, rawText: "raw", diagnosis: makeDiag(cause) },
        attempt2: null,
        rawExtractionKeys: null,
      });
      assert.ok(
        !(body.error as string).includes("unrecognized response format"),
        `cause '${cause}' still produces the old generic message: "${body.error}"`,
      );
    }
  });
});

// ─── retryable — collage/multiple-document image ─────────────────────────────

describe("retryable flag — multiple-document and non-retryable cases", () => {

  test("MULTIPLE_DOCUMENTS_DETECTED is retryable:false", () => {
    const r = classifyContentResult({
      docType: "Multiple Documents",
      classificationConfidence: 80,
    });
    assert.ok(r !== null);
    assert.equal(r.retryable, false);
  });

  test("UNSUPPORTED_DOCUMENT is retryable:false", () => {
    const r = classifyContentResult({ docType: "Unknown" });
    assert.ok(r !== null);
    assert.equal(r.retryable, false);
  });

  test("LOW_CONFIDENCE is retryable:true", () => {
    const r = classifyContentResult({
      docType: "Credit Card",
      classificationConfidence: 10,
    });
    assert.ok(r !== null);
    assert.equal(r.retryable, true);
  });

  test("model_refusal produces retryable:false (do not retry bad document types)", () => {
    const body = buildDiagnosticFailureBody({
      file: "test.jpg",
      attempt1: {
        meta: mockMeta,
        rawText: "I'm sorry, I cannot extract financial data from this.",
        diagnosis: makeDiag("model_refusal"),
      },
      attempt2: null,
      rawExtractionKeys: null,
    });
    assert.equal(body.retryable, false);
  });

  test("empty_response produces retryable:true (blurry/unclear — user should try again)", () => {
    const body = buildDiagnosticFailureBody({
      file: "dark.jpg",
      attempt1: {
        meta: { ...mockMeta, finishReason: null },
        rawText: "",
        diagnosis: makeDiag("empty_response"),
      },
      attempt2: null,
      rawExtractionKeys: null,
    });
    assert.equal(body.retryable, true);
  });

  test("zod_schema_mismatch produces retryable:true (transient schema issue)", () => {
    const body = buildDiagnosticFailureBody({
      file: "paystub.jpg",
      attempt1: {
        meta: mockMeta,
        rawText: '{"docType": "Paystub", "confidence": "95%"}',
        diagnosis: makeDiag("zod_schema_mismatch"),
      },
      attempt2: null,
      rawExtractionKeys: ["docType", "confidence"],
    });
    assert.equal(body.retryable, true);
  });
});

// ─── Blurry / unreadable / cropped images ─────────────────────────────────────

describe("blurry, cropped, and unreadable image scenarios", () => {

  test("blurry image: AI returns empty response → UNREADABLE_DOCUMENT", () => {
    const body = buildDiagnosticFailureBody({
      file: "blurry-photo.jpg",
      attempt1: {
        meta: { ...mockMeta, finishReason: null, responseChars: 0 },
        rawText: "",
        diagnosis: makeDiag("empty_response", "Model returned empty content. finish_reason=null"),
      },
      attempt2: null,
      rawExtractionKeys: null,
    });

    assert.equal(body.resultCode, "UNREADABLE_DOCUMENT");
    assert.equal(body.retryable, true);
    const msg = body.error as string;
    assert.ok(
      msg.includes("blurry") || msg.includes("unclear") || msg.includes("read"),
      `message should explain readability problem: "${msg}"`,
    );
  });

  test("cropped document: AI classificationConfidence very low → LOW_CONFIDENCE", () => {
    // The AI extracts something but is only 10% confident — likely a crop
    const r = classifyContentResult({
      docType: "Credit Card Statement",
      classificationConfidence: 10,
      fields: { currentBalance: { value: 1234, confidence: 30 } },
    });

    assert.ok(r !== null);
    assert.equal(r.code, "LOW_CONFIDENCE");
    assert.equal(r.retryable, true);
    assert.ok(
      r.message.includes("clearer image") || r.message.includes("confidently"),
      `message should guide user: "${r.message}"`,
    );
  });

  test("high-confidence valid extraction passes through classification", () => {
    const r = classifyContentResult({
      docType: "Credit Card Statement",
      classificationConfidence: 88,
      institution: { rawName: "Chase", isKnownInstitution: true },
    });
    assert.equal(r, null, "valid extraction should not be rejected");
  });
});

// ─── Batch isolation ──────────────────────────────────────────────────────────

describe("batch isolation — one failure does not affect others", () => {

  test("classifyContentResult is pure — different inputs produce independent results", () => {
    const inputs = [
      { docType: "Multiple Documents", classificationConfidence: 80 },
      { docType: "Credit Card", classificationConfidence: 92 },
      { docType: "Unknown" },
      { docType: "Bank Statement", classificationConfidence: 87 },
      { docType: "Credit Card", classificationConfidence: 5 },
    ];

    const results = inputs.map(i => classifyContentResult(i));

    // Only the MULTIPLE_DOCUMENTS, UNKNOWN, and LOW_CONFIDENCE entries should be rejected
    assert.equal(results[0]?.code, "MULTIPLE_DOCUMENTS_DETECTED");  // rejected
    assert.equal(results[1], null);                                   // passes
    assert.equal(results[2]?.code, "UNSUPPORTED_DOCUMENT");          // rejected
    assert.equal(results[3], null);                                   // passes
    assert.equal(results[4]?.code, "LOW_CONFIDENCE");                // rejected
  });

  test("failed document's fields are not accessible from a successful document's result", () => {
    // Simulate two docs processed in sequence
    const doc1Result = classifyContentResult({
      docType: "Multiple Documents",
      classificationConfidence: 80,
      fields: { balance: { value: 99999, confidence: 90 } }, // should never be saved
    });
    const doc2Result = classifyContentResult({
      docType: "Credit Card",
      classificationConfidence: 92,
    });

    assert.ok(doc1Result !== null, "doc1 is rejected");
    assert.equal(doc2Result, null, "doc2 passes independently");

    // doc2's classification result contains nothing from doc1
    // (since classifyContentResult returns null for doc2, there's no mixing)
  });

  test("zero valid documents: all rejected extractions produce retryable info", () => {
    const docs = [
      { docType: "Multiple Documents", classificationConfidence: 80 },
      { docType: "Unknown" },
      { docType: "Credit Card", classificationConfidence: 5 },
    ];

    const rejected = docs
      .map(d => classifyContentResult(d))
      .filter((r): r is NonNullable<ReturnType<typeof classifyContentResult>> => r !== null);

    // All three are rejected
    assert.equal(rejected.length, 3);

    // None of them are confused about retryable
    const multipleDocResult = rejected.find(r => r.code === "MULTIPLE_DOCUMENTS_DETECTED");
    assert.equal(multipleDocResult?.retryable, false);

    const unsupportedResult = rejected.find(r => r.code === "UNSUPPORTED_DOCUMENT");
    assert.equal(unsupportedResult?.retryable, false);

    const lowConfResult = rejected.find(r => r.code === "LOW_CONFIDENCE");
    assert.equal(lowConfResult?.retryable, true);
  });
});

// ─── Provider response shapes (JSON parse recovery) ───────────────────────────

describe("provider response handling via buildDiagnosticFailureBody", () => {

  test("valid direct JSON — successful parse does not reach buildDiagnosticFailureBody", () => {
    // classifyContentResult handles the post-parse semantic check
    const r = classifyContentResult({
      docType: "Bank Statement",
      classificationConfidence: 91,
      institution: { rawName: "Chase Bank" },
    });
    assert.equal(r, null, "valid direct JSON should pass content classification");
  });

  test("fenced JSON — markdown_wrapping cause → INVALID_STRUCTURED_RESPONSE", () => {
    const body = buildDiagnosticFailureBody({
      file: "statement.jpg",
      attempt1: {
        meta: mockMeta,
        rawText: "```json\n{ \"docType\": \"Bank Statement\" }\n```",
        diagnosis: makeDiag("markdown_wrapping", "Response contains markdown code fences."),
      },
      attempt2: null,
      rawExtractionKeys: null,
    });
    assert.equal(body.resultCode, "INVALID_STRUCTURED_RESPONSE");
    assert.equal(body.retryable, true);
  });

  test("JSON with surrounding text — extra_explanatory_text cause → INVALID_STRUCTURED_RESPONSE", () => {
    const body = buildDiagnosticFailureBody({
      file: "doc.jpg",
      attempt1: {
        meta: mockMeta,
        rawText: "Here is the extraction: { \"docType\": \"Paystub\" } (confidence: high)",
        diagnosis: makeDiag("extra_explanatory_text"),
      },
      attempt2: null,
      rawExtractionKeys: null,
    });
    assert.equal(body.resultCode, "INVALID_STRUCTURED_RESPONSE");
    assert.equal(body.retryable, true);
  });

  test("stringified JSON — handled by recovery; if all fails, invalid_json_syntax → INVALID_STRUCTURED_RESPONSE", () => {
    const body = buildDiagnosticFailureBody({
      file: "doc.jpg",
      attempt1: {
        meta: mockMeta,
        rawText: '"{\"docType\": \"Credit Card\"}"',
        diagnosis: makeDiag("invalid_json_syntax"),
      },
      attempt2: null,
      rawExtractionKeys: null,
    });
    assert.equal(body.resultCode, "INVALID_STRUCTURED_RESPONSE");
    assert.equal(body.retryable, true);
  });

  test("truncated output — truncated_output cause → INVALID_STRUCTURED_RESPONSE, retryable", () => {
    const body = buildDiagnosticFailureBody({
      file: "large.pdf",
      attempt1: {
        meta: { ...mockMeta, finishReason: "length", completionTokens: 2048 },
        rawText: '{"docType": "Credit Card", "fields": {"currentBalance":',
        diagnosis: makeDiag("truncated_output", "finish_reason=length"),
      },
      attempt2: null,
      rawExtractionKeys: null,
    });
    assert.equal(body.resultCode, "INVALID_STRUCTURED_RESPONSE");
    assert.equal(body.retryable, true);
  });

  test("empty response — empty_response cause → UNREADABLE_DOCUMENT, retryable", () => {
    const body = buildDiagnosticFailureBody({
      file: "blank.jpg",
      attempt1: {
        meta: { ...mockMeta, finishReason: null, responseChars: 0 },
        rawText: "",
        diagnosis: makeDiag("empty_response"),
      },
      attempt2: null,
      rawExtractionKeys: null,
    });
    assert.equal(body.resultCode, "UNREADABLE_DOCUMENT");
    assert.equal(body.retryable, true);
  });

  test("refusal response — model_refusal → UNSUPPORTED_DOCUMENT, not retryable", () => {
    const body = buildDiagnosticFailureBody({
      file: "reciept.jpg",
      attempt1: {
        meta: mockMeta,
        rawText: "I'm sorry but I cannot help with that request.",
        diagnosis: makeDiag("model_refusal"),
      },
      attempt2: null,
      rawExtractionKeys: null,
    });
    assert.equal(body.resultCode, "UNSUPPORTED_DOCUMENT");
    assert.equal(body.retryable, false);
  });

  test("malformed JSON — invalid_json_syntax → INVALID_STRUCTURED_RESPONSE, retryable", () => {
    const body = buildDiagnosticFailureBody({
      file: "bad.jpg",
      attempt1: {
        meta: mockMeta,
        rawText: "{ docType: 'Credit Card', balance: 3500 }",  // invalid JSON (unquoted keys)
        diagnosis: makeDiag("invalid_json_syntax"),
      },
      attempt2: null,
      rawExtractionKeys: null,
    });
    assert.equal(body.resultCode, "INVALID_STRUCTURED_RESPONSE");
    assert.equal(body.retryable, true);
  });

  test("missing required fields (zod_schema_mismatch) → INVALID_STRUCTURED_RESPONSE, retryable", () => {
    const body = buildDiagnosticFailureBody({
      file: "partial.jpg",
      attempt1: {
        meta: mockMeta,
        rawText: '{"docType": "Credit Card"}',
        diagnosis: makeDiag("zod_schema_mismatch", "docType: Required; fields: Required"),
      },
      attempt2: null,
      rawExtractionKeys: ["docType"],
    });
    assert.equal(body.resultCode, "INVALID_STRUCTURED_RESPONSE");
    assert.equal(body.retryable, true);
    // rawExtractionKeys are still in the response for developer diagnostics
    assert.deepEqual(body.rawExtractionKeys, ["docType"]);
  });

  test("nested response structure — multiple_json_objects → INVALID_STRUCTURED_RESPONSE, retryable", () => {
    const body = buildDiagnosticFailureBody({
      file: "nested.jpg",
      attempt1: {
        meta: mockMeta,
        rawText: '{"metadata":{"id":1}} {"docType":"Credit Card","fields":{}}',
        diagnosis: makeDiag("multiple_json_objects", "2 separate JSON objects found."),
      },
      attempt2: null,
      rawExtractionKeys: null,
    });
    assert.equal(body.resultCode, "INVALID_STRUCTURED_RESPONSE");
    assert.equal(body.retryable, true);
  });
});

// ─── No sensitive details in frontend error responses ─────────────────────────

describe("no sensitive details in frontend-visible error fields", () => {

  function isSafe(msg: string): boolean {
    if (typeof msg !== "string" || !msg) return false;
    if (/\bat [A-Za-z].*:\d+/.test(msg)) return false;    // stack trace
    if (/\bError:\s/.test(msg)) return false;               // Error: prefix
    if (/\/home\/runner/.test(msg)) return false;           // internal paths
    if (/node_modules/.test(msg)) return false;
    if (/sk-[A-Za-z0-9]{20,}/.test(msg)) return false;    // API key
    if (/[A-Za-z0-9]{40,}/.test(msg)) return false;        // long token
    return true;
  }

  test("all buildDiagnosticFailureBody error messages are safe", () => {
    const causes = [
      "empty_response", "model_refusal", "truncated_output",
      "markdown_wrapping", "extra_explanatory_text",
      "multiple_json_objects", "invalid_json_syntax",
      "zod_schema_mismatch", "unknown",
    ] as const;

    for (const cause of causes) {
      const body = buildDiagnosticFailureBody({
        file: "test.jpg",
        attempt1: { meta: mockMeta, rawText: "raw", diagnosis: makeDiag(cause) },
        attempt2: null,
        rawExtractionKeys: null,
      });
      assert.ok(isSafe(body.error as string), `cause '${cause}' error message is safe: "${body.error}"`);
    }
  });

  test("all classifyContentResult messages are safe", () => {
    const cases = [
      { docType: "Multiple Documents", classificationConfidence: 80 },
      { docType: "Unknown" },
      { docType: "Credit Card", classificationConfidence: 5 },
    ];

    for (const input of cases) {
      const r = classifyContentResult(input);
      if (!r) continue;
      assert.ok(isSafe(r.message), `message is safe: "${r.message}"`);
    }
  });

  test("diagnosis object never contains rawHead or rawTail in response body", () => {
    const pii = "account 1234-5678 SSN 999-00-1111 John Doe";
    const body = buildDiagnosticFailureBody({
      file: "sensitive.pdf",
      attempt1: {
        meta: mockMeta,
        rawText: pii,
        diagnosis: { cause: "invalid_json_syntax", detail: "no delimiters", rawHead: pii, rawTail: pii },
      },
      attempt2: null,
      rawExtractionKeys: null,
    });

    const bodyStr = JSON.stringify(body);
    assert.ok(!bodyStr.includes(pii), "PII from rawHead/rawTail must not appear in response body");
    assert.ok(!("rawHead" in (body.diagnosis as object)), "rawHead key must not be in diagnosis");
    assert.ok(!("rawTail" in (body.diagnosis as object)), "rawTail key must not be in diagnosis");
  });
});
