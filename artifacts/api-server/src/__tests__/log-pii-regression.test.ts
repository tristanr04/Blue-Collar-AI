/**
 * Issue 2 — Raw financial data in logs regression tests.
 *
 * The AI scanner processes uploaded financial documents (paystubs, bank
 * statements, etc.).  When the model response fails to parse or validate, the
 * old code logged `rawResponse: rawText1` — the verbatim AI output that may
 * echo back account numbers, balances, names, or other document PII.
 *
 * These static-analysis tests guarantee that no logger call in scan.ts
 * emits raw AI output, and that the FailureDiagnosis type no longer carries
 * rawHead / rawTail slices.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../routes/scan.ts", import.meta.url), "utf8");

test("scan.ts never logs raw AI output via rawResponse field", () => {
  // The forbidden pattern is any logger call that includes rawResponse: as a key.
  assert.doesNotMatch(
    source,
    /rawResponse\s*:/,
    "`rawResponse:` must not appear in any logger call — it would emit verbatim AI output that can contain PII.",
  );
});

test("scan.ts never logs raw AI output via rawResponse2 field", () => {
  assert.doesNotMatch(
    source,
    /rawResponse2\s*:/,
    "`rawResponse2:` must not appear in any logger call — it would emit verbatim AI output that can contain PII.",
  );
});

test("FailureDiagnosis interface does not carry rawHead or rawTail", () => {
  // These fields were removed to prevent them from appearing in diagnostic
  // objects passed to logger.warn().
  assert.doesNotMatch(
    source,
    /rawHead\s*:\s*string/,
    "`rawHead: string` must not be in FailureDiagnosis — raw AI output must not appear in interface fields.",
  );
  assert.doesNotMatch(
    source,
    /rawTail\s*:\s*string/,
    "`rawTail: string` must not be in FailureDiagnosis — raw AI output must not appear in interface fields.",
  );
});

test("classifyResponseFailure does not create raw-text slice variables", () => {
  // The old code created rawHead = rawText.slice(0, 600) and
  // rawTail = rawText.slice(-300) which were then spread into return objects.
  assert.doesNotMatch(
    source,
    /const rawHead\s*=/,
    "`const rawHead =` must not appear — the raw-text slice variable was removed.",
  );
  assert.doesNotMatch(
    source,
    /const rawTail\s*=/,
    "`const rawTail =` must not appear — the raw-text slice variable was removed.",
  );
});

test("scan.ts return objects in classifyResponseFailure do not spread rawHead or rawTail", () => {
  // The shorthand spread `rawHead, rawTail,` inside return { ... } objects
  // would expose raw text through every return branch of classifyResponseFailure.
  assert.doesNotMatch(
    source,
    /rawHead,\s*rawTail,/,
    "Shorthand `rawHead, rawTail,` spread must not appear in any return object.",
  );
});

test("truncated_output branch does not include raw tail slice in detail string", () => {
  // The old detail had: `Last chars: …${rawTail.slice(-80)}`
  // That substring of the raw model output must not appear in logs.
  assert.doesNotMatch(
    source,
    /rawTail\.slice/,
    "rawTail.slice must not appear — do not embed raw AI output slices in log detail strings.",
  );
});

test("no logger call in scan.ts references a raw AI text variable", () => {
  // Verify that none of the allowed raw text variable names (rawText1, rawText2)
  // appear as values inside any logger object literal.
  // Pattern: `rawText1` or `rawText2` appearing as a value (after `:`) in a
  // logger.warn / logger.info / logger.error / logger.debug call.
  assert.doesNotMatch(
    source,
    /logger\.\w+\s*\(\s*\{[^}]{0,2000}:\s*rawText[12]/s,
    "logger calls must not include rawText1 or rawText2 as values — verbatim AI output is PII-sensitive.",
  );
});

test("classifyResponseFailure returns only cause and detail (no raw text fields)", () => {
  // Extract the FailureDiagnosis interface definition and verify it only
  // contains 'cause' and 'detail' as typed properties.
  const interfaceMatch = source.match(
    /interface FailureDiagnosis\s*\{([\s\S]*?)\}/,
  );
  assert.ok(interfaceMatch, "FailureDiagnosis interface must exist.");
  const body = interfaceMatch[1];
  // Only comment lines and cause/detail should appear.
  const typedProps = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"));
  for (const prop of typedProps) {
    assert.match(
      prop,
      /^(cause|detail)\s*:/,
      `Unexpected property in FailureDiagnosis: "${prop}" — only cause and detail are allowed.`,
    );
  }
});
