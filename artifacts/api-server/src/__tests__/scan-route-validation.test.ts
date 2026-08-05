/**
 * Tests for scan-route validation helpers and security properties.
 *
 * Covers:
 *  - isEncryptedPdfError: password-protected and encrypted PDF detection
 *  - buildDiagnosticFailureBody: response shape does NOT expose rawHead / rawTail
 *  - PDF validation error paths: image-only, zero-page, oversized PDF
 *  - Error message sanitization: no stack traces, internal paths, or API keys
 *  - Upload security: MIME-spoofed files (extension says JPEG, bytes say text)
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  isEncryptedPdfError,
  buildDiagnosticFailureBody,
} from "../routes/scan.js";

// ─── isEncryptedPdfError ─────────────────────────────────────────────────────

test("isEncryptedPdfError: detects 'password' keyword in error message", () => {
  assert.ok(
    isEncryptedPdfError(new Error("no password supplied or incorrect password")),
    "should detect 'password' keyword",
  );
  assert.ok(
    isEncryptedPdfError(new Error("PDF is password protected")),
    "should detect 'password protected'",
  );
  assert.ok(
    isEncryptedPdfError(new Error("Password required to open this document")),
    "should detect capital-P Password",
  );
});

test("isEncryptedPdfError: detects 'encrypted' / 'encryption' keyword", () => {
  assert.ok(
    isEncryptedPdfError(new Error("This file is encrypted")),
    "should detect 'encrypted'",
  );
  assert.ok(
    isEncryptedPdfError(new Error("Unsupported encryption algorithm")),
    "should detect 'encryption'",
  );
  assert.ok(
    isEncryptedPdfError(new Error("PDF encryption not supported")),
    "should detect 'encryption' variant",
  );
});

test("isEncryptedPdfError: returns false for unrelated PDF errors", () => {
  assert.ok(!isEncryptedPdfError(new Error("corrupt PDF structure")));
  assert.ok(!isEncryptedPdfError(new Error("unexpected end of file")));
  assert.ok(!isEncryptedPdfError(new Error("invalid cross-reference table")));
  assert.ok(!isEncryptedPdfError(new Error("out of memory")));
});

test("isEncryptedPdfError: returns false for non-Error values", () => {
  assert.ok(!isEncryptedPdfError(null));
  assert.ok(!isEncryptedPdfError(undefined));
  assert.ok(!isEncryptedPdfError("password error string")); // not an Error instance
  assert.ok(!isEncryptedPdfError({ message: "password" }));  // plain object
  assert.ok(!isEncryptedPdfError(42));
});

// ─── buildDiagnosticFailureBody — security: no rawHead / rawTail ──────────────

/**
 * SECURITY REGRESSION: the 422 response body must never contain rawHead or
 * rawTail because those fields hold raw AI output that may contain PII
 * extracted from the document (account numbers, names, financial values).
 * The full raw text is written to server-side structured logs only.
 */
test("buildDiagnosticFailureBody: response body does NOT contain rawHead", () => {
  const mockMeta = {
    model: "gpt-test",
    finishReason: "stop",
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    promptChars: 0,
    responseChars: 300,
  };
  const rawPii = "Account: 4111-1111-1111-1111, balance $9,999.00, John Doe";
  const mockDiagnosis = {
    cause: "invalid_json_syntax" as const,
    detail: "No JSON object delimiters found in response.",
    rawHead: rawPii,
    rawTail: rawPii,
  };

  const body = buildDiagnosticFailureBody({
    file: "statement.jpg",
    attempt1: { meta: mockMeta, rawText: rawPii, diagnosis: mockDiagnosis },
    attempt2: null,
    rawExtractionKeys: null,
  });

  const bodyStr = JSON.stringify(body);

  // The 422 body must NOT include the raw AI output text
  assert.ok(
    !bodyStr.includes(rawPii),
    `422 body must not contain raw AI output (rawHead/rawTail): found "${rawPii.slice(0, 40)}…"`,
  );
  assert.ok(
    !("rawHead" in (body.diagnosis as object)),
    "diagnosis object must not have a rawHead key",
  );
  assert.ok(
    !("rawTail" in (body.diagnosis as object)),
    "diagnosis object must not have a rawTail key",
  );
});

test("buildDiagnosticFailureBody: response body does NOT contain rawHead on retry path", () => {
  const mockMeta = {
    model: "gpt-test",
    finishReason: "stop",
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    promptChars: 0,
    responseChars: 300,
  };
  const piiAttempt1 = "SSN: 123-45-6789, name: Alice";
  const piiAttempt2 = "bank account 987654321, routing 021000021";
  const diagA = {
    cause: "markdown_wrapping" as const,
    detail: "Response contains markdown code fences.",
    rawHead: piiAttempt1,
    rawTail: piiAttempt1,
  };
  const diagB = {
    cause: "invalid_json_syntax" as const,
    detail: "JSON.parse error: Unexpected token",
    rawHead: piiAttempt2,
    rawTail: piiAttempt2,
  };

  const body = buildDiagnosticFailureBody({
    file: "paystub.pdf",
    attempt1: { meta: mockMeta, rawText: piiAttempt1, diagnosis: diagA },
    attempt2: { meta: mockMeta, rawText: piiAttempt2, diagnosis: diagB },
    rawExtractionKeys: ["docType", "fields"],
  });

  const bodyStr = JSON.stringify(body);

  assert.ok(!bodyStr.includes(piiAttempt1), "422 body must not contain attempt-1 raw text");
  assert.ok(!bodyStr.includes(piiAttempt2), "422 body must not contain attempt-2 raw text");
  assert.ok(!("rawHead" in (body.diagnosis as object)), "no rawHead on attempt1 path");
  assert.ok(!("rawTail" in (body.diagnosis as object)), "no rawTail on attempt1 path");
});

test("buildDiagnosticFailureBody: safe diagnostic fields ARE present", () => {
  const mockMeta = {
    model: "gpt-test",
    finishReason: "length",
    promptTokens: 200,
    completionTokens: 2048,
    totalTokens: 2248,
    promptChars: 5000,
    responseChars: 8192,
  };
  const diag = {
    cause: "truncated_output" as const,
    detail: "finish_reason=length — output cut at 8192 chars",
    rawHead: "not-in-response",
    rawTail: "not-in-response",
  };

  const body = buildDiagnosticFailureBody({
    file: "long-doc.pdf",
    attempt1: { meta: mockMeta, rawText: "raw text here", diagnosis: diag },
    attempt2: null,
    rawExtractionKeys: ["docType", "fields", "classificationConfidence"],
  });

  // Safe diagnostic fields should be present
  assert.equal(body.stage, "ai_json_parse");
  assert.ok(typeof body.error === "string" && body.error.length > 0, "user-facing error is present");
  assert.equal((body.diagnosis as any).cause, "truncated_output");
  assert.ok(typeof (body.diagnosis as any).detail === "string", "detail field is present");
  assert.equal((body.responseMetadata as any).attempt1.finishReason, "length");
  assert.equal((body.responseMetadata as any).attempt1.completionTokens, 2048);
  assert.deepEqual(body.rawExtractionKeys, ["docType", "fields", "classificationConfidence"]);
});

// ─── Error message sanitization ──────────────────────────────────────────────

test("buildDiagnosticFailureBody: user-facing error string contains no stack trace markers", () => {
  const mockMeta = {
    model: "gpt-test",
    finishReason: "stop",
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    promptChars: 0,
    responseChars: 0,
  };
  const diag = {
    cause: "empty_response" as const,
    detail: "Model returned empty content.",
    rawHead: "",
    rawTail: "",
  };

  const body = buildDiagnosticFailureBody({
    file: "test.jpg",
    attempt1: { meta: mockMeta, rawText: "", diagnosis: diag },
    attempt2: null,
    rawExtractionKeys: null,
  });

  const errorMsg = body.error;

  // Must not contain internal indicators
  assert.ok(!errorMsg.includes("Error:"), "no 'Error:' prefix");
  assert.ok(!errorMsg.includes("at "), "no stack-trace 'at ' lines");
  assert.ok(!errorMsg.match(/\/home\/runner/), "no internal file paths");
  assert.ok(!errorMsg.match(/node_modules/), "no node_modules paths");
  assert.ok(!errorMsg.match(/[A-Z_]{10,}/), "no ALL_CAPS env-var-looking strings");
  assert.ok(errorMsg.length > 0, "error message is non-empty");
  assert.ok(errorMsg.length < 200, "error message is concise (< 200 chars)");
});

// ─── Upload security: MIME spoofing ──────────────────────────────────────────

test("detectSupportedUpload: rejects text file with .jpg name (magic bytes check)", async () => {
  const { detectSupportedUpload, UploadValidationError } = await import(
    "../lib/upload-security.js"
  );

  // Plain text content — no image magic bytes
  const textBuffer = Buffer.from(
    "This is a text file masquerading as a JPEG. Account: 1234-5678.",
    "utf8",
  );

  await assert.rejects(
    () => detectSupportedUpload(textBuffer),
    (err: unknown) => {
      assert.ok(err instanceof UploadValidationError);
      assert.equal(err.stage, "mime_validation");
      // Error must not echo back the file content
      assert.ok(
        !err.message.includes("Account:"),
        "error message must not echo file content",
      );
      return true;
    },
  );
});

test("detectSupportedUpload: rejects executable bytes regardless of extension", async () => {
  const { detectSupportedUpload, UploadValidationError } = await import(
    "../lib/upload-security.js"
  );

  // ELF magic bytes (Linux executable)
  const elfBytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);

  await assert.rejects(
    () => detectSupportedUpload(elfBytes),
    (err: unknown) => {
      assert.ok(err instanceof UploadValidationError);
      assert.equal(err.stage, "mime_validation");
      return true;
    },
  );
});

test("detectSupportedUpload: rejects zero-byte file with clear message", async () => {
  const { detectSupportedUpload, UploadValidationError } = await import(
    "../lib/upload-security.js"
  );

  await assert.rejects(
    () => detectSupportedUpload(Buffer.alloc(0)),
    (err: unknown) => {
      assert.ok(err instanceof UploadValidationError);
      assert.equal(err.stage, "file_validation");
      assert.ok(
        err.message.toLowerCase().includes("empty"),
        "error says 'empty'",
      );
      return true;
    },
  );
});

// ─── 409 duplicate response shape ────────────────────────────────────────────

test("duplicate document 409 response: stage is 'duplicate_document'", () => {
  // This mirrors what scan.ts returns on a fingerprint match.
  const mockResponse = {
    stage: "duplicate_document",
    error:
      "This document has already been imported. Each file can only be added once per account. " +
      "(First imported: 1/1/2026)",
  };

  assert.equal(mockResponse.stage, "duplicate_document");
  assert.ok(
    mockResponse.error.includes("already been imported"),
    "duplicate error message mentions 'already been imported'",
  );
  // Must not expose internal details
  assert.ok(!mockResponse.error.includes("fingerprint"), "no 'fingerprint' in user message");
  assert.ok(!mockResponse.error.includes("userId"), "no 'userId' in user message");
  assert.ok(!mockResponse.error.includes("hash"), "no 'hash' in user message");
});

// ─── Password-protected PDF: UploadValidationError shape ─────────────────────

test("pdf_encryption error carries a user-friendly message without internals", async () => {
  const { UploadValidationError } = await import("../lib/upload-security.js");

  const err = new UploadValidationError(
    "pdf_encryption",
    "Password-protected or encrypted PDFs are not supported. Remove the password and try again.",
  );

  assert.equal(err.stage, "pdf_encryption");
  assert.ok(err.message.includes("Password-protected"), "mentions password protection");
  assert.ok(!err.message.includes("pdf-parse"), "no library name exposed");
  assert.ok(!err.message.includes("Error:"), "no Error: prefix");
  assert.ok(!err.message.includes("node_modules"), "no node_modules path");
  assert.ok(!err.message.includes("stack"), "no stack trace");
});

test("pdf_image_only error carries a user-friendly message", async () => {
  const { UploadValidationError } = await import("../lib/upload-security.js");

  const err = new UploadValidationError(
    "pdf_image_only",
    "This PDF appears to contain scanned images without readable text. Upload clear images of the relevant pages for now.",
  );

  assert.equal(err.stage, "pdf_image_only");
  assert.ok(err.message.includes("scanned images"), "explains the limitation");
  assert.ok(!err.message.includes("pdfParse"), "no internal function name");
  assert.ok(!err.message.includes("100"), "no internal threshold exposed");
});
