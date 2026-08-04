/**
 * Unit tests for the JSON recovery pipeline in scan.ts.
 *
 * These are white-box tests of the helper functions that are NOT exported.
 * We replicate them here (keep in sync with scan.ts).
 *
 * Covers all 9 requirements from the "unrecognized response format" fix:
 *   1. Strip markdown code fences
 *   2. Remove text before first {
 *   3. Remove text after last }
 *   4. Multiple JSON objects → use largest valid one
 *   5. JSON repair (trailing commas, missing braces, escaped newlines)
 *   6-8. Retry logic is exercised via integration (route handler) — not unit-testable here
 *   9. Raw response logged on failure — verified by log assertions in integration tests
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ─── Replicated helpers (keep in sync with scan.ts) ──────────────────────────

function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    const val = JSON.parse(text);
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      return val as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return null;
}

function escapeLiteralNewlinesInStrings(text: string): string {
  let result = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      result += ch;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      result += ch;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString && (ch === "\n" || ch === "\r")) {
      result += ch === "\n" ? "\\n" : "\\r";
      continue;
    }
    result += ch;
  }
  return result;
}

function closeUnclosedDelimiters(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (const ch of text) {
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if ((ch === "}" || ch === "]") && stack.length) stack.pop();
  }

  return text + stack.reverse().join("");
}

function repairJson(text: string): string {
  let s = text;
  s = escapeLiteralNewlinesInStrings(s);  // literal \n / \r in strings
  s = closeUnclosedDelimiters(s);         // missing closing delimiters FIRST …
  s = s.replace(/,(\s*[}\]])/g, "$1");   // … then trailing commas (catches comma before appended })
  return s;
}

function extractAllJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects.sort((a, b) => b.length - a.length);
}

function recoverJsonString(raw: string): Record<string, unknown> | null {
  // Stage 1: strip ALL code fence markers
  let text = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();

  // Stage 2: trim to first { … last }
  const fb = text.indexOf("{");
  const lb = text.lastIndexOf("}");
  if (fb !== -1 && lb > fb) {
    text = text.slice(fb, lb + 1);
  }

  // Stage 3: direct parse
  const direct = tryParseObject(text);
  if (direct) return direct;

  // Stage 4: repair then parse
  const repairedText = repairJson(text);
  const repaired = tryParseObject(repairedText);
  if (repaired) return repaired;

  // Stage 4b: if repair closed a missing brace but a prose prefix still exists,
  // trim to first { … last } in the repaired string and retry.
  const rfb = repairedText.indexOf("{");
  const rlb = repairedText.lastIndexOf("}");
  if (rfb !== -1 && rlb > rfb) {
    const trimmedRepaired = tryParseObject(repairedText.slice(rfb, rlb + 1));
    if (trimmedRepaired) return trimmedRepaired;
  }

  // Stage 5: extract every { … } span and try each (largest first)
  for (const candidate of extractAllJsonObjects(raw)) {
    const plain = tryParseObject(candidate);
    if (plain) return plain;
    const fixed = tryParseObject(repairJson(candidate));
    if (fixed) return fixed;
  }

  return null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("JSON recovery — code fence stripping (requirement 1)", () => {
  it("strips leading ```json fence", () => {
    const raw = '```json\n{"docType":"Paystub"}\n```';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Paystub");
  });

  it("strips leading ``` fence (no language tag)", () => {
    const raw = '```\n{"docType":"Paystub"}\n```';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Paystub");
  });

  it("strips code fence that appears mid-string (GPT double-wraps)", () => {
    const raw = 'Here is your JSON:\n```json\n{"docType":"Checking Account"}\n```\nDone.';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Checking Account");
  });

  it("passes clean JSON through without corruption", () => {
    const raw = '{"docType":"Credit Card","classificationConfidence":90}';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Credit Card");
    assert.equal(result?.classificationConfidence, 90);
  });
});

describe("JSON recovery — prefix/suffix trimming (requirements 2 & 3)", () => {
  it("removes prose before the first {", () => {
    const raw = 'Certainly! Here is the extraction:\n{"docType":"Mortgage"}';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Mortgage");
  });

  it("removes prose after the last }", () => {
    const raw = '{"docType":"Auto Loan"}\n\nPlease verify the values.';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Auto Loan");
  });

  it("removes prose both before and after the JSON block", () => {
    const raw = 'Here is the result:\n{"docType":"401(k)"}\nEnd of response.';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "401(k)");
  });

  it("returns null when there is no { character at all", () => {
    const result = recoverJsonString("No JSON here at all.");
    assert.equal(result, null);
  });
});

describe("JSON recovery — multiple JSON objects (requirement 4)", () => {
  it("uses the larger of two separate objects", () => {
    // Small stub first, large object second
    const raw = '{"ok":true} {"docType":"Bank Statement","institution":{"rawName":"Chase"},"fields":{}}';
    const result = recoverJsonString(raw);
    // Should pick the larger one (Bank Statement object)
    assert.equal(result?.docType, "Bank Statement");
  });

  it("picks the largest valid object when first span is invalid JSON", () => {
    // First object has a syntax error; second is valid
    const raw = '{"broken":,} {"docType":"Savings Account","balance":1000}';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Savings Account");
  });

  it("ignores surrounding non-JSON text when extracting objects", () => {
    const raw = 'Note A: {"docType":"Paystub","grossPay":5000} Note B: some extra text';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Paystub");
    assert.equal(result?.grossPay, 5000);
  });
});

describe("JSON repair — trailing commas (requirement 5a)", () => {
  it("removes trailing comma before }", () => {
    const raw = '{"docType":"HSA Investment Account","balance":500,}';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "HSA Investment Account");
    assert.equal(result?.balance, 500);
  });

  it("removes trailing comma before ] in nested array", () => {
    const raw = '{"docType":"Brokerage Account","unknownFields":["foo","bar",]}';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Brokerage Account");
    assert.deepEqual(result?.unknownFields, ["foo", "bar"]);
  });

  it("removes multiple trailing commas at different nesting levels", () => {
    const raw = '{"docType":"Roth IRA","fields":{"balance":{"value":12000,},},"unknownFields":[],}';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Roth IRA");
  });
});

describe("JSON repair — missing closing braces (requirement 5b)", () => {
  it("closes a single unclosed {", () => {
    const raw = '{"docType":"Traditional IRA","balance":9000';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Traditional IRA");
    assert.equal(result?.balance, 9000);
  });

  it("closes nested unclosed { { }", () => {
    const raw = '{"docType":"Roth 401(k)","institution":{"rawName":"Fidelity"';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Roth 401(k)");
  });

  it("closes unclosed [ inside object", () => {
    const raw = '{"docType":"Pension","unknownFields":["dividend"';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Pension");
  });

  it("combines trailing-comma repair and missing-brace repair in one pass", () => {
    const raw = '{"docType":"SEP IRA","balance":44000,';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "SEP IRA");
    assert.equal(result?.balance, 44000);
  });
});

describe("JSON repair — escaped newlines (requirement 5c)", () => {
  it("escapes a literal newline inside a string value", () => {
    // Construct a string that contains an actual \n byte inside a JSON string value
    const raw = '{"docType":"Monthly Bill","memo":"line one\nline two"}';
    const result = recoverJsonString(raw);
    // After recovery the memo should be the two-line string
    assert.equal(result?.docType, "Monthly Bill");
    assert.ok(typeof result?.memo === "string");
  });

  it("does not double-escape an already-escaped \\n sequence", () => {
    const raw = '{"docType":"Utility Bill","memo":"line one\\nline two"}';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Utility Bill");
    // The \\n is already valid JSON — value should be the literal string "line one\nline two"
    assert.equal(result?.memo, "line one\nline two");
  });

  it("handles literal CR inside a string value", () => {
    const raw = '{"docType":"Credit Card","note":"amount\rdue"}';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Credit Card");
  });
});

describe("JSON recovery — edge cases", () => {
  it("returns null for completely non-JSON input", () => {
    assert.equal(recoverJsonString("This document is a W-2 form."), null);
  });

  it("returns null for empty string", () => {
    assert.equal(recoverJsonString(""), null);
  });

  it("returns null for a JSON array (not an object)", () => {
    // Top-level arrays are not valid extraction responses
    assert.equal(recoverJsonString('["a","b"]'), null);
  });

  it("handles deeply nested valid JSON without corruption", () => {
    const raw = JSON.stringify({
      docType: "Checking Account",
      institution: { rawName: "Wells Fargo", isKnownInstitution: true },
      fields: {
        currentBalance: { value: 2145.5, confidence: 92, sourceText: "$2,145.50" },
        availableBalance: { value: 2000.0, confidence: 88, sourceText: "$2,000.00" },
      },
      unknownFields: [],
      classificationConfidence: 92,
    });
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Checking Account");
    assert.equal((result?.institution as any)?.rawName, "Wells Fargo");
  });

  it("recovers from combination: code fence + trailing comma + missing brace", () => {
    const raw = '```json\n{"docType":"HELOC","balance":55000,\n```';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "HELOC");
    assert.equal(result?.balance, 55000);
  });

  it("recovers from combination: prose prefix + trailing comma + missing bracket", () => {
    const raw = 'Here is the result:\n{"docType":"Student Loan","unknownFields":["deferment period",';
    const result = recoverJsonString(raw);
    assert.equal(result?.docType, "Student Loan");
  });
});

describe("escapeLiteralNewlinesInStrings — unit", () => {
  it("leaves valid JSON untouched", () => {
    const input = '{"a":"hello world"}';
    assert.equal(escapeLiteralNewlinesInStrings(input), input);
  });

  it("escapes a lone newline inside a string", () => {
    const input = '{"a":"hello\nworld"}';
    const result = escapeLiteralNewlinesInStrings(input);
    assert.equal(result, '{"a":"hello\\nworld"}');
  });

  it("does not escape newlines that appear between keys (structural whitespace)", () => {
    const input = '{\n"a":"b"\n}';
    const result = escapeLiteralNewlinesInStrings(input);
    assert.equal(result, input); // structural newlines outside strings are left alone
  });

  it("handles already-escaped backslash inside string before a newline", () => {
    // "a\\b\nc" — the \\ is an escaped backslash, \n is a literal newline
    const input = '{"a":"a\\\\b\nc"}';
    const result = escapeLiteralNewlinesInStrings(input);
    // The literal \n should be replaced; the \\\\ (escaped backslash) must remain
    assert.ok(result.includes("\\\\b\\nc"), `unexpected result: ${result}`);
  });
});

describe("closeUnclosedDelimiters — unit", () => {
  it("returns unchanged text when braces are balanced", () => {
    const input = '{"a":"b"}';
    assert.equal(closeUnclosedDelimiters(input), input);
  });

  it("appends one missing }", () => {
    const input = '{"a":"b"';
    assert.equal(closeUnclosedDelimiters(input), '{"a":"b"}');
  });

  it("appends missing } and ]", () => {
    const input = '{"a":["b"';
    assert.equal(closeUnclosedDelimiters(input), '{"a":["b"]}');
  });

  it("does not strip extra closing delimiters", () => {
    // Extra } — closeUnclosedDelimiters only appends, never removes
    const input = '{"a":"b"}}';
    // Stack pops on first }, then stack is empty, second } is ignored by pop
    const result = closeUnclosedDelimiters(input);
    // Original text returned as-is (the unmatched } just empties the stack)
    assert.equal(result, input);
  });
});

describe("extractAllJsonObjects — unit", () => {
  it("extracts a single object", () => {
    const objects = extractAllJsonObjects('{"a":1}');
    assert.equal(objects.length, 1);
    assert.equal(objects[0], '{"a":1}');
  });

  it("extracts two separate objects", () => {
    const objects = extractAllJsonObjects('{"a":1} {"b":2,"c":3}');
    assert.equal(objects.length, 2);
  });

  it("returns objects sorted by length descending (largest first)", () => {
    const objects = extractAllJsonObjects('{"a":1} {"longKey":"longValue","anotherKey":99}');
    assert.ok(objects[0].length > objects[1].length);
  });

  it("does not confuse { inside a string with a new object", () => {
    const objects = extractAllJsonObjects('{"a":"has { curly }","b":2}');
    assert.equal(objects.length, 1);
    assert.equal(objects[0], '{"a":"has { curly }","b":2}');
  });

  it("handles nested objects correctly", () => {
    const objects = extractAllJsonObjects('{"outer":{"inner":1}}');
    assert.equal(objects.length, 1); // only one top-level object
    assert.ok(objects[0].includes('"inner"'));
  });
});
