import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TAX_FILING_STATUSES,
  US_STATE_CODES,
} from "../profile-context-api";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.resolve(here, "../profile-context-api.ts"),
  "utf8",
);

test("includes all 50 states and DC exactly once", () => {
  assert.equal(US_STATE_CODES.length, 51);
  assert.equal(new Set(US_STATE_CODES).size, 51);
  assert.ok(US_STATE_CODES.includes("OK"));
  assert.ok(US_STATE_CODES.includes("DC"));
});

test("exposes the four supported filing statuses", () => {
  assert.deepEqual(TAX_FILING_STATUSES, [
    "Single",
    "Married Filing Jointly",
    "Married Filing Separately",
    "Head of Household",
  ]);
});

test("always sends the Clerk bearer token", () => {
  assert.match(source, /Authorization:\s*`Bearer \$\{token\}`/);
});

test("uses the authenticated profile-context endpoint", () => {
  assert.match(source, /\/api/);
  assert.match(source, /\/profile-context/);
  assert.doesNotMatch(source, /userId\s*:/);
});

test("uses PUT for validated context updates", () => {
  assert.match(source, /method:\s*"PUT"/);
  assert.match(source, /JSON\.stringify\(input\)/);
});
