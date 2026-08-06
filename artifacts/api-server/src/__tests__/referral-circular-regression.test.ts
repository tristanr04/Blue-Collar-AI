/**
 * Referral circular-chain prevention regression tests.
 *
 * Verifies that:
 *  - Self-referral is rejected.
 *  - Direct circular referral (A refers B, B refers A) is rejected.
 *  - Multi-hop circular referral (A→B→C→A) is rejected.
 *  - A tampered / unknown code is rejected.
 *  - A valid non-circular referral succeeds.
 *
 * Note: These tests require a live DATABASE_URL because referral logic
 * runs real DB queries. Each test uses time-based unique user IDs to
 * prevent state bleed between runs.
 */

import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import {
  getOrCreateReferralCode,
  startReferralAttribution,
  attachReferralToUser,
  ReferralError,
} from "../lib/referral-repository.js";
import { db, usersTable } from "@workspace/db";

const uid = (s: string) => `ref-circ-${s}-${Date.now()}`;

async function ensureUser(userId: string) {
  await db.insert(usersTable).values({ id: userId }).onConflictDoNothing();
}

/**
 * Full referral flow: create referral code for referrer,
 * open the link as visitor, then attach to referred user.
 */
async function doReferral(referrerUserId: string, referredUserId: string): Promise<void> {
  const code = await getOrCreateReferralCode(referrerUserId);
  const { token } = await startReferralAttribution({ code: code.code });
  await attachReferralToUser(token, referredUserId);
}

describe("referral-circular-regression", () => {
  const A = uid("A");
  const B = uid("B");
  const C = uid("C");
  const D = uid("D");

  before(async () => {
    await Promise.all([
      ensureUser(A),
      ensureUser(B),
      ensureUser(C),
      ensureUser(D),
    ]);
  });

  test("self-referral is rejected", async () => {
    const code = await getOrCreateReferralCode(A);
    const { token } = await startReferralAttribution({ code: code.code });
    try {
      await attachReferralToUser(token, A);
      assert.fail("Self-referral should throw");
    } catch (e) {
      assert.ok(e instanceof ReferralError);
      assert.equal((e as ReferralError).code, "self_referral");
    }
  });

  test("direct circular referral A→B then B→A is rejected", async () => {
    const userA = uid("direct-A");
    const userB = uid("direct-B");
    await ensureUser(userA);
    await ensureUser(userB);

    // A refers B (valid)
    await doReferral(userA, userB);

    // B tries to refer A (circular — B was referred by A, so A referring B again would cycle)
    const codeB = await getOrCreateReferralCode(userB);
    const { token } = await startReferralAttribution({ code: codeB.code });
    try {
      await attachReferralToUser(token, userA);
      assert.fail("Circular referral should throw");
    } catch (e) {
      assert.ok(e instanceof ReferralError);
      assert.equal((e as ReferralError).code, "circular_referral");
    }
  });

  test("multi-hop circular A→B→C→A is rejected", async () => {
    const userA = uid("hop-A");
    const userB = uid("hop-B");
    const userC = uid("hop-C");
    await ensureUser(userA);
    await ensureUser(userB);
    await ensureUser(userC);

    // A refers B, B refers C (valid)
    await doReferral(userA, userB);
    await doReferral(userB, userC);

    // C tries to refer A (would create A→B→C→A loop)
    const codeC = await getOrCreateReferralCode(userC);
    const { token } = await startReferralAttribution({ code: codeC.code });
    try {
      await attachReferralToUser(token, userA);
      assert.fail("3-hop circular referral should throw");
    } catch (e) {
      assert.ok(e instanceof ReferralError);
      assert.equal((e as ReferralError).code, "circular_referral");
    }
  });

  test("valid non-circular referral succeeds", async () => {
    const referrer = uid("valid-referrer");
    const referred = uid("valid-referred");
    await ensureUser(referrer);
    await ensureUser(referred);

    // Should not throw
    await doReferral(referrer, referred);
    // No assertion needed — if no throw, the test passes
  });

  test("tampered code returns code_not_found error", async () => {
    try {
      await startReferralAttribution({ code: "NOTREAL" });
      assert.fail("Tampered code should throw");
    } catch (e) {
      assert.ok(e instanceof ReferralError);
      assert.equal((e as ReferralError).code, "code_not_found");
    }
  });
});
