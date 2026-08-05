import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositorySource = await readFile(
  new URL("../lib/audit-repository.ts", import.meta.url),
  "utf8",
);
const schemaSource = await readFile(
  new URL("../../../../lib/db/src/schema/audit.ts", import.meta.url),
  "utf8",
);

test("audit reads are always scoped to the authenticated user", () => {
  assert.match(repositorySource, /eq\(auditEventsTable\.userId, userId\)/);
  assert.doesNotMatch(repositorySource, /userId\?:\s*string/);
});

test("audit metadata strips common secret and raw-document fields", () => {
  for (const key of [
    "authorization",
    "cookie",
    "token",
    "secret",
    "password",
    "fileBuffer",
    "rawDocument",
    "requestBody",
  ]) {
    assert.match(repositorySource, new RegExp(`"${key}"`));
  }
  assert.match(repositorySource, /FORBIDDEN_METADATA_KEYS\.has\(key\)/);
});

test("audit history uses bounded cursor pagination", () => {
  assert.match(repositorySource, /Math\.min\(Math\.max\(options\.limit \?\? 50, 1\), 100\)/);
  assert.match(repositorySource, /lt\(auditEventsTable\.createdAt, options\.before\)/);
  assert.match(repositorySource, /orderBy\(desc\(auditEventsTable\.createdAt\)\)/);
});

test("audit records are user-owned and indexed", () => {
  assert.match(schemaSource, /references\(\(\) => usersTable\.id, \{ onDelete: "cascade" \}\)/);
  assert.match(schemaSource, /audit_events_user_created_idx/);
  assert.match(schemaSource, /audit_events_user_entity_idx/);
  assert.match(schemaSource, /audit_events_request_idx/);
});
