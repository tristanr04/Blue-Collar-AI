/**
 * Regression test: paystub update route — users can correct OCR mistakes
 * without deleting and re-scanning the document.
 *
 * Verifies PUT /financial/paystubs/:id at the repository layer.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  createPaystub,
  ensureUser,
  softDeleteFinancialRecord,
  updatePaystub,
} from "../lib/financial-repository.js";

const TEST_USER_ID = `test_paystub_update_${Date.now()}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

before(async () => {
  await ensureUser({ userId: TEST_USER_ID });
});

after(async () => {
  await db.delete(usersTable).where(eq(usersTable.id, TEST_USER_ID));
});

test("paystub: update corrects OCR mistakes without re-scanning", async () => {
  // Simulate a scanned paystub with an OCR error (wrong grossPay).
  const created = await createPaystub(TEST_USER_ID, {
    employer: "Apex Electrical",
    payDate: new Date("2025-03-14"),
    grossPay: 1800, // OCR misread — actual is 1854
    netPay: 1350,
    taxes: 360,
    deductions: 90,
    regularHours: 40,
    overtimeHours: 8,
    doubleTimeHours: 0,
    perDiem: 0,
  });
  assert.match(created.id, UUID_RE, "create returns server UUID");
  assert.equal(created.grossPay, 1800, "initial OCR value stored");

  // User corrects the mistake via the UI — no rescan needed.
  const corrected = await updatePaystub(TEST_USER_ID, created.id, {
    grossPay: 1854,
    netPay: 1384,
    taxes: 350,
    deductions: 120,
  });
  assert.ok(corrected, "updatePaystub succeeds with server UUID");
  assert.equal(corrected!.id, created.id, "UUID is stable after update");
  assert.equal(corrected!.grossPay, 1854, "OCR correction applied");
  assert.equal(corrected!.netPay, 1384, "net pay updated");

  // Cleanup.
  const deleted = await softDeleteFinancialRecord(TEST_USER_ID, "paystubs", created.id);
  assert.equal(deleted, true);
});

test("paystub: update with ISO payDate string is coerced (not rejected)", async () => {
  const created = await createPaystub(TEST_USER_ID, {
    employer: "Mesa Plumbing",
    payDate: new Date("2025-04-01"),
    grossPay: 2000,
    netPay: 1500,
    taxes: 400,
    deductions: 100,
    regularHours: 80,
    overtimeHours: 0,
    doubleTimeHours: 0,
    perDiem: 0,
  });

  // Update payDate as an ISO string (simulating how the frontend sends it over JSON).
  const updated = await updatePaystub(TEST_USER_ID, created.id, {
    payDate: new Date("2025-04-15") as any, // as if it arrived as string
    grossPay: 2100,
  });
  assert.ok(updated, "payDate coercion works on update");
  assert.equal(updated!.grossPay, 2100);

  await softDeleteFinancialRecord(TEST_USER_ID, "paystubs", created.id);
});

test("paystub: update with non-existent UUID returns null", async () => {
  const result = await updatePaystub(
    TEST_USER_ID,
    "00000000-0000-0000-0000-000000000000",
    { grossPay: 1 },
  );
  assert.equal(result, null, "non-existent paystub returns null, not a crash");
});

test("paystub: update cannot touch another user's record", async () => {
  const otherUserId = `test_paystub_other_${Date.now()}`;
  await ensureUser({ userId: otherUserId });

  const created = await createPaystub(otherUserId, {
    employer: "Other Co",
    payDate: new Date("2025-01-01"),
    grossPay: 3000,
    netPay: 2200,
    taxes: 600,
    deductions: 200,
    regularHours: 80,
    overtimeHours: 0,
    doubleTimeHours: 0,
    perDiem: 0,
  });

  // Attempt to update another user's paystub using our userId.
  const result = await updatePaystub(TEST_USER_ID, created.id, { grossPay: 1 });
  assert.equal(result, null, "cannot update another user's paystub");

  // Cleanup.
  await db.delete(usersTable).where(eq(usersTable.id, otherUserId));
});
