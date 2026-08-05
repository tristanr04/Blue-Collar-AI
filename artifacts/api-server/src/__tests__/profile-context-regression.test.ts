import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeSource = await readFile(
  new URL("../routes/profile-context.ts", import.meta.url),
  "utf8",
);
const repositorySource = await readFile(
  new URL("../lib/profile-context-repository.ts", import.meta.url),
  "utf8",
);
const routesIndexSource = await readFile(
  new URL("../routes/index.ts", import.meta.url),
  "utf8",
);

test("profile context routes require verified authentication", () => {
  assert.match(routeSource, /router\.use\("\/profile-context", requireAuthenticatedUser\)/);
  assert.match(routeSource, /authenticatedUserId/);
  assert.doesNotMatch(routeSource, /req\.body\.userId/);
  assert.doesNotMatch(routeSource, /req\.query\.userId/);
});

test("profile context reads and writes are always scoped to the authenticated user", () => {
  assert.match(repositorySource, /eq\(profileContextTable\.userId, userId\)/);
  assert.match(repositorySource, /userId,/);
  assert.match(repositorySource, /target: profileContextTable\.userId/);
  assert.doesNotMatch(repositorySource, /input\.userId/);
});

test("profile context updates use shared schema validation", () => {
  assert.match(repositorySource, /insertProfileContextSchema\.parse\(input\)/);
});

test("sensitive profile context responses cannot be cached", () => {
  assert.match(routeSource, /private, no-store, no-cache, must-revalidate/);
  assert.match(routeSource, /Pragma/);
  assert.match(routeSource, /Expires/);
});

test("profile context writes create sanitized audit events", () => {
  assert.match(routeSource, /appendAuditEvent/);
  assert.match(routeSource, /entityType: "profile_context"/);
  assert.match(routeSource, /changedFields: Object\.keys/);
  assert.doesNotMatch(routeSource, /metadata:\s*req\.body/);
});

test("profile context router is registered", () => {
  assert.match(routesIndexSource, /profileContextRouter/);
  assert.match(routesIndexSource, /router\.use\(profileContextRouter\)/);
});
