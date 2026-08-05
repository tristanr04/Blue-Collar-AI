import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeSource = await readFile(
  new URL("../routes/background-jobs.ts", import.meta.url),
  "utf8",
);
const routeIndexSource = await readFile(
  new URL("../routes/index.ts", import.meta.url),
  "utf8",
);
const workerSource = await readFile(
  new URL("../lib/background-worker.ts", import.meta.url),
  "utf8",
);

test("background job routes require authentication and user-scoped reads", () => {
  assert.match(routeSource, /router\.use\("\/jobs", requireAuthenticatedUser\)/);
  assert.match(routeSource, /getBackgroundJobForUser\(userId, jobId\)/);
  assert.match(routeSource, /listQueuedJobsForUser\(userId, limit\)/);
  assert.doesNotMatch(routeSource, /req\.body\.userId|req\.query\.userId|req\.params\.userId/);
});

test("job identifiers and list sizes are validated", () => {
  assert.match(routeSource, /z\.string\(\)\.uuid\(\)/);
  assert.match(routeSource, /max\(100\)/);
});

test("background job routes are registered", () => {
  assert.match(routeIndexSource, /backgroundJobsRouter/);
  assert.match(routeIndexSource, /router\.use\(backgroundJobsRouter\)/);
});

test("worker uses atomic claims and ownership-checked completion paths", () => {
  assert.match(workerSource, /claimNextBackgroundJob\(this\.workerId\)/);
  assert.match(workerSource, /completeBackgroundJob\(job\.id, this\.workerId, result\)/);
  assert.match(workerSource, /failBackgroundJob\(job, this\.workerId/);
});

test("worker recovers stale locks and supports graceful shutdown", () => {
  assert.match(workerSource, /releaseStaleBackgroundJobs/);
  assert.match(workerSource, /stop\(\): void/);
  assert.match(workerSource, /while \(!this\.stopped\)/);
});
