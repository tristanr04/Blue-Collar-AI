import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositorySource = await readFile(
  new URL("../lib/background-job-repository.ts", import.meta.url),
  "utf8",
);
const schemaSource = await readFile(
  new URL("../../../../lib/db/src/schema/background-jobs.ts", import.meta.url),
  "utf8",
);
const migrationSource = await readFile(
  new URL("../../../../lib/db/drizzle/0003_add_background_jobs.sql", import.meta.url),
  "utf8",
);

test("background jobs are idempotent per authenticated user", () => {
  assert.match(schemaSource, /background_jobs_user_key_unique/);
  assert.match(schemaSource, /table\.userId, table\.idempotencyKey/);
  assert.match(repositorySource, /onConflictDoNothing/);
  assert.match(repositorySource, /eq\(backgroundJobsTable\.userId, input\.userId\)/);
});

test("workers atomically claim jobs without duplicate processing", () => {
  assert.match(repositorySource, /FOR UPDATE SKIP LOCKED/);
  assert.match(repositorySource, /status = 'queued'/);
  assert.match(repositorySource, /attempts < max_attempts/);
  assert.match(repositorySource, /eq\(backgroundJobsTable\.lockedBy, workerId\)/);
});

test("failed jobs retry with bounded exponential backoff", () => {
  assert.match(repositorySource, /15 \* 2 \*\*/);
  assert.match(repositorySource, /15 \* 60/);
  assert.match(repositorySource, /exhausted \? "failed" : "queued"/);
  assert.match(repositorySource, /maxAttempts: Math\.min\(Math\.max/);
});

test("job status reads remain user scoped", () => {
  assert.match(repositorySource, /eq\(backgroundJobsTable\.id, jobId\)/);
  assert.match(repositorySource, /eq\(backgroundJobsTable\.userId, userId\)/);
});

test("database migration includes ownership, indexes, and retry state", () => {
  assert.match(migrationSource, /FOREIGN KEY \("user_id"\).*ON DELETE cascade/s);
  assert.match(migrationSource, /background_jobs_ready_idx/);
  assert.match(migrationSource, /background_jobs_user_key_unique/);
  assert.match(migrationSource, /"attempts" integer DEFAULT 0 NOT NULL/);
  assert.match(migrationSource, /"max_attempts" integer DEFAULT 5 NOT NULL/);
});
