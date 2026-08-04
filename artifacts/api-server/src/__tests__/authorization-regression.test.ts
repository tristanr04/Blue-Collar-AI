import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("all financial routes remain behind verified Clerk authentication", () => {
  const routes = source("../routes/financial-data.ts");

  assert.match(
    routes,
    /router\.use\(["']\/financial["'],\s*requireAuthenticatedUser\)/,
    "The complete /financial route group must remain protected by requireAuthenticatedUser.",
  );
  assert.match(
    routes,
    /req\.authenticatedUserId/,
    "Financial routes must derive identity from authenticated middleware state.",
  );
  assert.doesNotMatch(
    routes,
    /(?:req\.body|req\.query|req\.params)\.userId/,
    "Financial routes must never trust a client-supplied userId.",
  );
});

test("financial repository operations remain scoped to the authenticated user", () => {
  const repository = source("../lib/financial-repository.ts");

  const ownedTables = [
    "profilesTable",
    "paystubsTable",
    "debtsTable",
    "billsTable",
    "assetsTable",
  ];

  for (const table of ownedTables) {
    assert.match(
      repository,
      new RegExp(`eq\\(${table}\\.userId,\\s*userId\\)`),
      `${table} queries must include an authenticated-user ownership predicate.`,
    );
  }

  const createFunctions = ["createPaystub", "createDebt", "createBill", "createAsset"];
  for (const functionName of createFunctions) {
    const start = repository.indexOf(`export async function ${functionName}`);
    assert.notEqual(start, -1, `${functionName} must exist.`);
    const nextExport = repository.indexOf("export async function", start + 1);
    const body = repository.slice(start, nextExport === -1 ? repository.length : nextExport);
    assert.match(
      body,
      /\.values\(\{\s*\.\.\.input,\s*userId\s*\}\)/,
      `${functionName} must override ownership with the authenticated userId.`,
    );
  }

  assert.doesNotMatch(
    repository,
    /\.values\(\{\s*userId:\s*input\.userId/,
    "Repository writes must never accept record ownership from parsed client input.",
  );
});

test("cross-user deletes preserve non-enumerating behavior", () => {
  const routes = source("../routes/financial-data.ts");
  const repository = source("../lib/financial-repository.ts");

  assert.match(
    repository,
    /eq\([^\n]+\.id,\s*recordId\)[\s\S]{0,180}eq\([^\n]+\.userId,\s*userId\)/,
    "Delete predicates must combine record ID and authenticated user ID.",
  );
  assert.match(
    routes,
    /Record was not found or does not belong to this account\./,
    "Delete responses should not reveal whether another user's record exists.",
  );
});

test("AI capability metadata remains authenticated and non-cacheable", () => {
  const routes = source("../routes/ai-ask.ts");

  assert.match(
    routes,
    /router\.get\(["']\/capabilities["'],\s*requireAuthenticatedUser,/,
    "/capabilities must require a verified Clerk session.",
  );
  assert.match(
    routes,
    /Cache-Control["'],\s*["']private, no-store/,
    "Capability metadata must not be stored in shared caches.",
  );
});
