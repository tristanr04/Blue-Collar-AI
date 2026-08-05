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

// ── Issue 4 additions: tax-scenarios route + repository authorization ─────

test("tax-scenarios routes are behind Clerk authentication", () => {
  const routes = source("../routes/tax-scenarios.ts");

  // The route group (or individual routes) must require authentication.
  assert.match(
    routes,
    /requireAuthenticatedUser/,
    "Tax-scenarios routes must be protected by requireAuthenticatedUser.",
  );

  // Routes must derive the user ID from middleware, not from client input.
  assert.match(
    routes,
    /req\.authenticatedUserId/,
    "Tax-scenarios routes must derive identity from authenticated middleware state.",
  );
  assert.doesNotMatch(
    routes,
    /(?:req\.body|req\.query|req\.params)\.userId/,
    "Tax-scenarios routes must never trust a client-supplied userId.",
  );
});

test("tax-scenarios repository scopes updates and deletes by userId in WHERE clause", () => {
  const repository = source("../lib/tax-scenarios-repository.ts");

  // Both the record id and the userId equality predicates must appear inside
  // an and() call.  Allow extra predicates (e.g. isNull(deletedAt)) between them.
  assert.match(
    repository,
    /and\s*\([\s\S]{0,400}eq\s*\([^)]+\.id,\s*id\)[\s\S]{0,400}eq\s*\([^)]+\.userId,\s*userId\)/,
    "Tax-scenario update/delete must include AND(eq(id), eq(userId)) in the WHERE clause.",
  );

  // userId predicate must be inside a .where() call (DB-level, not JS filter).
  assert.match(
    repository,
    /\.where\s*\([\s\S]{0,200}userId/,
    "userId ownership check must be inside a .where() predicate, not only a post-fetch JS filter.",
  );
});

test("tax-scenarios cross-user reads are rejected by ownership predicate", () => {
  const repository = source("../lib/tax-scenarios-repository.ts");

  // getTaxScenario (or equivalent) must scope SELECT by userId.
  assert.match(
    repository,
    /eq\s*\([^)]+\.userId,\s*userId\)/,
    "Tax-scenario reads must filter by the authenticated userId.",
  );
});

// ── Issue 4 additions: background-jobs route + repository authorization ───

test("background-jobs routes are behind Clerk authentication", () => {
  const routes = source("../routes/background-jobs.ts");

  assert.match(
    routes,
    /requireAuthenticatedUser/,
    "Background-job routes must be protected by requireAuthenticatedUser.",
  );

  assert.match(
    routes,
    /req\.authenticatedUserId/,
    "Background-job routes must derive identity from authenticated middleware state.",
  );
  assert.doesNotMatch(
    routes,
    /(?:req\.body|req\.query|req\.params)\.userId/,
    "Background-job routes must never trust a client-supplied userId.",
  );
});

test("background-jobs repository scopes job reads by userId in WHERE clause", () => {
  const repository = source("../lib/background-job-repository.ts");

  // getBackgroundJobForUser must AND both jobId and userId.
  assert.match(
    repository,
    /and\s*\(\s*eq\s*\([^,]+,\s*(?:jobId|id)\)[^)]*,\s*eq\s*\([^,]+,\s*userId\)\s*\)/,
    "getBackgroundJobForUser must scope by AND(eq(id/jobId), eq(userId)) — prevents cross-user enumeration.",
  );

  // Ownership must be inside a .where() call.
  assert.match(
    repository,
    /\.where\s*\([^)]*userId/,
    "userId ownership check must be inside a .where() predicate, not only a post-fetch JS filter.",
  );
});

test("background-jobs cross-user reads are rejected by ownership predicate", () => {
  const repository = source("../lib/background-job-repository.ts");

  // The userId equality must be present in the query.
  assert.match(
    repository,
    /eq\s*\([^)]+\.userId,\s*userId\)/,
    "Background-job reads must filter by the authenticated userId.",
  );
});
