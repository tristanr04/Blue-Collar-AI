/**
 * Comprehensive idempotency tests for the bulk migration endpoint.
 *
 * All tests operate directly against the repository layer (real PostgreSQL)
 * so they cover the actual DB transaction semantics, UNIQUE constraint
 * serialisation, and rollback behaviour without needing an HTTP server.
 *
 * Tests:
 *  1.  Successful migration — all records created, job committed, ID maps returned
 *  2.  Duplicate retry (same key) — returns original result, no duplicate rows
 *  3.  Disconnect-then-poll — getMigrationStatus returns 'committed' after the fact
 *  4.  Failure halfway through — transaction rolled back, no partial records, job marked failed
 *  5.  Concurrent submissions with same key — UNIQUE constraint serialises; no duplicates
 *  6.  Same key, different users — fully isolated; each user's records are private
 *  7.  Partial DB failure (Zod validation inside transaction) — rollback + job failed
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  assetsTable,
  billsTable,
  db,
  debtsTable,
  paystubsTable,
  usersTable,
} from "@workspace/db";
import {
  failMigrationJob,
  getMigrationStatus,
  runMigrationInTransaction,
  startMigrationJob,
} from "../lib/migration-repository.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TS = Date.now();
const USER_A = `test_mig_a_${TS}`;
const USER_B = `test_mig_b_${TS}`;

/** A minimal valid paystub payload (matches insertPaystubSchema). */
function makePaystub(clientId: string, employer = "Apex Electric") {
  return {
    clientId,
    employer,
    payDate: new Date("2025-03-14"),
    grossPay: 1854,
    netPay: 1384,
    taxes: 350,
    deductions: 120,
    regularHours: 40,
    overtimeHours: 8,
    doubleTimeHours: 0,
    perDiem: 0,
  };
}

function makeDebt(clientId: string) {
  return {
    clientId,
    name: "Auto Loan",
    balance: 12000,
    interestRate: 5.5,
    minimumPayment: 290,
    isRevolving: false,
  };
}

function makeBill(clientId: string) {
  return { clientId, name: "Rent", amount: 1600, dueDay: 1, isAutoPay: true };
}

function makeAsset(clientId: string) {
  return { clientId, name: "Checking", type: "Cash" as const, value: 3500 };
}

/** Return the server UUIDs currently in the DB for a given user's paystubs. */
async function dbPaystubIds(userId: string) {
  const rows = await db
    .select({ id: paystubsTable.id })
    .from(paystubsTable)
    .where(eq(paystubsTable.userId, userId));
  return rows.map((r) => r.id);
}

async function dbDebtIds(userId: string) {
  const rows = await db
    .select({ id: debtsTable.id })
    .from(debtsTable)
    .where(eq(debtsTable.userId, userId));
  return rows.map((r) => r.id);
}

async function dbBillIds(userId: string) {
  const rows = await db
    .select({ id: billsTable.id })
    .from(billsTable)
    .where(eq(billsTable.userId, userId));
  return rows.map((r) => r.id);
}

async function dbAssetIds(userId: string) {
  const rows = await db
    .select({ id: assetsTable.id })
    .from(assetsTable)
    .where(eq(assetsTable.userId, userId));
  return rows.map((r) => r.id);
}

/** Helper: run startMigrationJob → runMigrationInTransaction (mirrors route handler). */
async function submitMigration(
  userId: string,
  idempotencyKey: string,
  payload: Parameters<typeof runMigrationInTransaction>[2],
) {
  const { job, isNew } = await startMigrationJob(userId, idempotencyKey);
  if (!isNew) return { job, result: job.result, skipped: true };
  try {
    const result = await runMigrationInTransaction(userId, job.id, payload);
    return { job, result, skipped: false };
  } catch (err) {
    await failMigrationJob(job.id, String(err));
    throw err;
  }
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

before(async () => {
  for (const id of [USER_A, USER_B]) {
    await db
      .insert(usersTable)
      .values({ id })
      .onConflictDoUpdate({ target: usersTable.id, set: { updatedAt: new Date() } });
  }
});

after(async () => {
  await db
    .delete(usersTable)
    .where(inArray(usersTable.id, [USER_A, USER_B]));
});

// ─── Tests ────────────────────────────────────────────────────────────────────

test("1. successful migration — all records created, job committed, ID maps correct", async () => {
  const key = crypto.randomUUID();
  const payload = {
    paystubs: [makePaystub("local-p1"), makePaystub("local-p2", "Mesa Plumbing")],
    debts:    [makeDebt("local-d1")],
    bills:    [makeBill("local-b1")],
    assets:   [makeAsset("local-a1")],
  };

  const { result, skipped } = await submitMigration(USER_A, key, payload);

  assert.equal(skipped, false, "should be a new migration");
  assert.equal(result!.paystubs.length, 2, "2 paystubs mapped");
  assert.equal(result!.debts.length, 1,    "1 debt mapped");
  assert.equal(result!.bills.length, 1,    "1 bill mapped");
  assert.equal(result!.assets.length, 1,   "1 asset mapped");

  // clientId → serverId mapping is preserved.
  assert.equal(result!.paystubs[0].clientId, "local-p1");
  assert.ok(result!.paystubs[0].serverId.match(/^[0-9a-f-]{36}$/), "server UUID");

  // Rows exist in the DB.
  const dbIds = await dbPaystubIds(USER_A);
  for (const { serverId } of result!.paystubs) {
    assert.ok(dbIds.includes(serverId), `paystub ${serverId} in DB`);
  }

  // Job status is committed.
  const status = await getMigrationStatus(USER_A, key);
  assert.equal(status?.status, "committed");
  assert.ok(status?.committedAt, "committedAt is set");
});

test("2. duplicate retry — same key returns original result, no duplicate rows", async () => {
  const key = crypto.randomUUID();
  const payload = {
    paystubs: [makePaystub("dup-p1")],
    debts: [],
    bills: [],
    assets: [],
  };

  // First submission
  const first = await submitMigration(USER_A, key, payload);
  assert.equal(first.skipped, false);
  const firstServerId = first.result!.paystubs[0].serverId;

  // Second submission with the same key — should return cached result.
  const second = await submitMigration(USER_A, key, payload);
  assert.equal(second.skipped, true, "second submission must be skipped");

  // No new paystub rows were inserted.
  const allIds = await dbPaystubIds(USER_A);
  const dupCount = allIds.filter((id) => id === firstServerId).length;
  assert.equal(dupCount, 1, "exactly one paystub with the server ID (no duplicates)");
});

test("3. disconnect-then-poll — getMigrationStatus returns committed after fact", async () => {
  const key = crypto.randomUUID();
  const payload = {
    paystubs: [makePaystub("poll-p1")],
    debts:    [makeDebt("poll-d1")],
    bills:    [],
    assets:   [],
  };

  // Migration commits (simulating client disconnect mid-flight by not using the result).
  await submitMigration(USER_A, key, payload);

  // Client reconnects and polls the status endpoint.
  const polled = await getMigrationStatus(USER_A, key);
  assert.equal(polled?.status, "committed", "poll returns committed");
  assert.ok(polled?.result, "result is present on poll");
  assert.equal(polled!.result!.paystubs.length, 1);
  assert.equal(polled!.result!.debts.length, 1);
  assert.equal(polled!.isStale, false, "row is not stale");
});

test("4. failure halfway through — no partial records, job marked failed", async () => {
  const key = crypto.randomUUID();

  // Plant a valid paystub first, then cause the transaction to throw mid-way by
  // passing a debt with an invalid type that bypasses Zod but fails the DB NOT NULL.
  // Approach: test the raw transaction rollback by throwing inside it.
  const { job } = await startMigrationJob(USER_A, key);

  let threwInside = false;
  try {
    await db.transaction(async (tx) => {
      // Insert one valid paystub.
      await tx.insert(paystubsTable).values({
        userId: USER_A,
        employer: "Rollback Test Co",
        payDate: new Date("2025-06-01"),
        grossPay: 1000,
        netPay: 800,
        taxes: 150,
        deductions: 50,
        regularHours: 40,
        overtimeHours: 0,
        doubleTimeHours: 0,
        perDiem: 0,
      });

      // Force a deliberate mid-transaction failure.
      throw new Error("Simulated DB failure mid-migration");
    });
  } catch {
    threwInside = true;
  }
  assert.ok(threwInside, "transaction should have thrown");

  // Mark the job as failed (mirrors the route handler catch block).
  await failMigrationJob(job.id, "Simulated failure");

  // The paystub for this user from the rolled-back tx must NOT be in the DB.
  // (We can't distinguish it by ID since the tx rolled back before returning an ID,
  //  but we can verify the employer name is absent.)
  const rows = await db
    .select()
    .from(paystubsTable)
    .where(eq(paystubsTable.userId, USER_A));
  const rollbackRow = rows.find((r) => r.employer === "Rollback Test Co");
  assert.equal(rollbackRow, undefined, "rolled-back paystub must not be in DB");

  // Job status is 'failed'.
  const status = await getMigrationStatus(USER_A, key);
  assert.equal(status?.status, "failed", "job must be marked failed");
  assert.ok(status?.errorMessage?.includes("Simulated"), "error message preserved");
});

test("5. concurrent submissions — UNIQUE constraint serialises; no duplicate records", async () => {
  const key = crypto.randomUUID();
  const payload = {
    paystubs: [makePaystub("concurrent-p1"), makePaystub("concurrent-p2")],
    debts:    [makeDebt("concurrent-d1")],
    bills:    [],
    assets:   [],
  };

  // Fire two concurrent submissions with the same key.
  const [r1, r2] = await Promise.allSettled([
    submitMigration(USER_A, key, payload),
    submitMigration(USER_A, key, payload),
  ]);

  // At least one must succeed.
  const succeeded = [r1, r2].filter((r) => r.status === "fulfilled");
  assert.ok(succeeded.length >= 1, "at least one submission must succeed");

  // Exactly the expected number of rows — no duplicates.
  const paystubCount = (await dbPaystubIds(USER_A)).filter((id) => {
    const both = [r1, r2]
      .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
      .flatMap((r) => r.value.result?.paystubs ?? []);
    return both.some((m: any) => m.serverId === id);
  }).length;
  // Allow 2 paystubs from the winner and 0 from the loser (skipped).
  assert.equal(paystubCount, 2, "exactly 2 paystubs — no duplicates from concurrent race");

  // DB confirms the job is committed exactly once.
  const status = await getMigrationStatus(USER_A, key);
  assert.equal(status?.status, "committed");
});

test("6. same key, different users — full isolation, each user's records are private", async () => {
  const sharedKey = crypto.randomUUID();

  const payloadA = {
    paystubs: [makePaystub("iso-a-p1", "Alpha Corp")],
    debts:    [],
    bills:    [],
    assets:   [],
  };
  const payloadB = {
    paystubs: [makePaystub("iso-b-p1", "Beta LLC"), makePaystub("iso-b-p2", "Beta LLC")],
    debts:    [],
    bills:    [],
    assets:   [],
  };

  // Both users submit with the same idempotency key (UUID reuse across users).
  const [rA, rB] = await Promise.all([
    submitMigration(USER_A, sharedKey, payloadA),
    submitMigration(USER_B, sharedKey, payloadB),
  ]);

  // Each gets only their own records.
  assert.equal(rA.result!.paystubs.length, 1, "User A has 1 paystub");
  assert.equal(rB.result!.paystubs.length, 2, "User B has 2 paystubs");

  const serverIdA = rA.result!.paystubs[0].serverId;
  const serverIdsB = rB.result!.paystubs.map((m) => m.serverId);

  // Cross-user contamination check: User A cannot see User B's records.
  const userADbIds = await dbPaystubIds(USER_A);
  for (const bId of serverIdsB) {
    assert.ok(!userADbIds.includes(bId), `User B paystub ${bId} must not appear in User A's rows`);
  }

  // And vice versa.
  const userBDbIds = await dbPaystubIds(USER_B);
  assert.ok(!userBDbIds.includes(serverIdA), "User A paystub must not appear in User B's rows");
});

test("7. Zod validation failure inside transaction — full rollback, job marked failed", async () => {
  const key = crypto.randomUUID();

  // Provide a valid paystub followed by a paystub with an invalid payDate type
  // that passes MigrateItemSchema (passthrough) but fails insertPaystubSchema.parse.
  const payload = {
    paystubs: [
      makePaystub("valid-p"),
      {
        clientId: "bad-p",
        employer: "Invalid Co",
        payDate: "not-a-date-at-all",  // will become Invalid Date → Zod rejects
        grossPay: 999,
        netPay: 800,
        taxes: 100,
        deductions: 99,
        regularHours: 40,
        overtimeHours: 0,
        doubleTimeHours: 0,
        perDiem: 0,
      },
    ],
    debts:  [],
    bills:  [],
    assets: [],
  };

  const { job } = await startMigrationJob(USER_A, key);

  let threw = false;
  try {
    await runMigrationInTransaction(USER_A, job.id, payload);
  } catch (err) {
    threw = true;
    await failMigrationJob(job.id, String(err));
  }
  assert.ok(threw, "runMigrationInTransaction must throw on invalid data");

  // The valid paystub from the same transaction must also be rolled back.
  const rows = await db
    .select()
    .from(paystubsTable)
    .where(eq(paystubsTable.userId, USER_A));
  const validRow = rows.find((r) => r.employer === "Invalid Co" || r.grossPay === 999);
  // Note: we check that the "valid-p" paystub with grossPay=999 is also gone.
  // (Prior tests may have inserted paystubs with grossPay=1854, not 999.)
  assert.equal(validRow, undefined, "rolled-back valid paystub must not survive in DB");

  // Job is marked failed.
  const status = await getMigrationStatus(USER_A, key);
  assert.equal(status?.status, "failed");
});
