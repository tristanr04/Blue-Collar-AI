/**
 * Regression tests: create → update → delete cycle uses server UUIDs throughout.
 *
 * These tests run against the real DATABASE_URL to prove that:
 *   - createXxx() returns a server-assigned UUID
 *   - updateXxx() succeeds when given that UUID (no page refresh needed)
 *   - softDeleteFinancialRecord() succeeds when given that UUID
 *
 * This is the server-side half of Priority 1 correctness.
 * The store-side half is the bgCreate/bgWithIdSync mechanism that replaces the
 * local placeholder UUID with the server UUID immediately after creation.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  createDebt,
  createBill,
  createAsset,
  createPaystub,
  ensureUser,
  softDeleteFinancialRecord,
  updateDebt,
  updateBill,
  updateAsset,
} from "../lib/financial-repository.js";

const TEST_USER_ID = `test_crud_regression_${Date.now()}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

before(async () => {
  await ensureUser({ userId: TEST_USER_ID });
});

after(async () => {
  // Clean up test user and all cascaded rows.
  await db.delete(usersTable).where(eq(usersTable.id, TEST_USER_ID));
});

// ─── Debt ─────────────────────────────────────────────────────────────────────

test("debt: create returns server UUID", async () => {
  const created = await createDebt(TEST_USER_ID, {
    name: "Regression Debt",
    balance: 5000,
    interestRate: 5.5,
    minimumPayment: 100,
  });
  assert.ok(created, "createDebt returns a record");
  assert.match(created.id, UUID_RE, "id is a valid UUID");
  assert.equal(created.balance, 5000);
  // cleanup
  await softDeleteFinancialRecord(TEST_USER_ID, "debts", created.id);
});

test("debt: create → update → delete without page refresh", async () => {
  const created = await createDebt(TEST_USER_ID, {
    name: "UUID Sync Debt",
    balance: 8000,
    interestRate: 12,
    minimumPayment: 200,
  });
  assert.match(created.id, UUID_RE, "create returns server UUID");

  // Update immediately using the server UUID — no reload required.
  const updated = await updateDebt(TEST_USER_ID, created.id, { balance: 7000 });
  assert.ok(updated, "update with server UUID succeeds without page refresh");
  assert.equal(updated!.id, created.id, "server UUID is stable after update");
  assert.equal(updated!.balance, 7000, "balance reflects the update");

  // Delete immediately using the server UUID — no reload required.
  const deleted = await softDeleteFinancialRecord(TEST_USER_ID, "debts", created.id);
  assert.equal(deleted, true, "delete with server UUID succeeds without page refresh");
});

test("debt: update with non-existent UUID returns null (not a crash)", async () => {
  const result = await updateDebt(TEST_USER_ID, "00000000-0000-0000-0000-000000000000", {
    balance: 1,
  });
  assert.equal(result, null, "update of non-existent record returns null");
});

test("debt: delete with non-existent UUID returns false (not a crash)", async () => {
  const result = await softDeleteFinancialRecord(
    TEST_USER_ID,
    "debts",
    "00000000-0000-0000-0000-000000000000",
  );
  assert.equal(result, false, "delete of non-existent record returns false");
});

// ─── Bill ─────────────────────────────────────────────────────────────────────

test("bill: create → update → delete without page refresh", async () => {
  const created = await createBill(TEST_USER_ID, {
    name: "Regression Bill",
    amount: 120,
    dueDay: 15,
    isAutoPay: false,
  });
  assert.match(created.id, UUID_RE);

  const updated = await updateBill(TEST_USER_ID, created.id, { amount: 130, isAutoPay: true });
  assert.ok(updated, "updateBill with server UUID succeeds");
  assert.equal(updated!.id, created.id);
  assert.equal(updated!.amount, 130);
  assert.equal(updated!.isAutoPay, true);

  const deleted = await softDeleteFinancialRecord(TEST_USER_ID, "bills", created.id);
  assert.equal(deleted, true);
});

// ─── Asset ────────────────────────────────────────────────────────────────────

test("asset: create → update → delete without page refresh", async () => {
  const created = await createAsset(TEST_USER_ID, {
    name: "Regression Asset",
    type: "Cash",
    value: 3000,
  });
  assert.match(created.id, UUID_RE);

  const updated = await updateAsset(TEST_USER_ID, created.id, { value: 3500 });
  assert.ok(updated, "updateAsset with server UUID succeeds");
  assert.equal(updated!.id, created.id);
  assert.equal(updated!.value, 3500);

  const deleted = await softDeleteFinancialRecord(TEST_USER_ID, "assets", created.id);
  assert.equal(deleted, true);
});

// ─── Paystub ──────────────────────────────────────────────────────────────────

test("paystub: create returns server UUID and correct field values", async () => {
  const created = await createPaystub(TEST_USER_ID, {
    employer: "Regression Corp",
    payDate: new Date("2025-01-15"),
    grossPay: 2000,
    netPay: 1500,
    taxes: 400,
    deductions: 100,
    regularHours: 80,
    overtimeHours: 0,
    doubleTimeHours: 0,
    perDiem: 0,
  });
  assert.match(created.id, UUID_RE, "paystub create returns server UUID");
  assert.equal(created.employer, "Regression Corp");
  assert.equal(created.grossPay, 2000);

  const deleted = await softDeleteFinancialRecord(TEST_USER_ID, "paystubs", created.id);
  assert.equal(deleted, true);
});
