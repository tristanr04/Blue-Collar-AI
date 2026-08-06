import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeSource = await readFile(new URL("../routes/ai-ask.ts", import.meta.url), "utf8");
const taxContextSource = await readFile(new URL("../lib/ai-tax-context.ts", import.meta.url), "utf8");

test("AI defaults to concise answer-first responses", () => {
  assert.match(routeSource, /Lead with the answer/);
  assert.match(routeSource, /60.120 words/);
  assert.match(routeSource, /max_completion_tokens: 400/);
  assert.doesNotMatch(routeSource, /repeat its formula and the inputs supplied/);
});

test("AI receives only the latest authenticated saved tax result", () => {
  assert.match(routeSource, /getLatestTaxEstimateForAI\(userId\)/);
  assert.match(routeSource, /latestSavedTaxEstimate/);
  assert.match(taxContextSource, /eq\(taxScenariosTable\.userId, userId\)/);
  assert.match(taxContextSource, /isNull\(taxScenariosTable\.deletedAt\)/);
  assert.match(taxContextSource, /orderBy\(desc\(taxScenariosTable\.updatedAt\)\)/);
  assert.doesNotMatch(taxContextSource, /inputs:/);
});

test("AI never invents a missing tax estimate", () => {
  assert.match(routeSource, /If latestSavedTaxEstimate is null, say a tax estimate has not been saved yet rather than guessing/);
});
