/**
 * Workspace repository regression tests.
 *
 * Covers the authorization and business-rule scenarios from Phase 3 Scenario F.
 * Each test group uses isolated user IDs to prevent cross-test state.
 */

import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import {
  createWorkspace,
  listUserWorkspaces,
  getWorkspace,
  listMembers,
  createInvitation,
  acceptInvitation,
  removeMember,
  promoteToAdmin,
  transferOwnership,
  revokeInvitation,
  WorkspaceError,
} from "../lib/workspace-repository.js";
import { db, usersTable } from "@workspace/db";

const uid = (s: string) => `ws-test-${s}-${Date.now()}`;

async function ensureUser(userId: string) {
  await db.insert(usersTable).values({ id: userId }).onConflictDoNothing();
}

describe("workspace-regression", () => {
  const OWNER = uid("owner");
  const MEMBER_A = uid("member-a");
  const MEMBER_B = uid("member-b");
  const OUTSIDER = uid("outsider");

  before(async () => {
    await Promise.all([
      ensureUser(OWNER),
      ensureUser(MEMBER_A),
      ensureUser(MEMBER_B),
      ensureUser(OUTSIDER),
    ]);
  });

  // ── Create workspace ──────────────────────────────────────────────────────

  test("owner is automatically added as owner member on create", async () => {
    const ws = await createWorkspace(OWNER, "Test Crew", 5);
    const members = await listMembers(OWNER, ws.id);
    const ownerMember = members.find((m) => m.userId === OWNER);
    assert.ok(ownerMember, "Owner must be a member");
    assert.equal(ownerMember.role, "owner");
    assert.equal(ownerMember.status, "active");
  });

  test("non-member cannot getWorkspace", async () => {
    const ws = await createWorkspace(OWNER, "Private WS", 5);
    try {
      await getWorkspace(OUTSIDER, ws.id);
      assert.fail("Should have thrown WorkspaceError");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError, "Must throw WorkspaceError");
      assert.equal((e as WorkspaceError).code, "forbidden");
    }
  });

  // ── Invitations ───────────────────────────────────────────────────────────

  test("invitation token can only be used once", async () => {
    const ws = await createWorkspace(OWNER, "One-Use WS", 5);
    const { token } = await createInvitation(OWNER, ws.id, "a@example.com");
    await acceptInvitation(token, MEMBER_A);

    // Second acceptance with same token must fail
    try {
      await acceptInvitation(token, MEMBER_B);
      assert.fail("Duplicate acceptance should throw");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError);
      assert.equal((e as WorkspaceError).code, "invalid_invitation");
    }
  });

  test("revoked invitation cannot be accepted", async () => {
    const ws = await createWorkspace(OWNER, "Revoke WS", 5);
    const { token, invitation } = await createInvitation(OWNER, ws.id, "b@example.com");
    await revokeInvitation(OWNER, ws.id, invitation.id);

    try {
      await acceptInvitation(token, MEMBER_A);
      assert.fail("Revoked invitation should throw");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError);
      assert.equal((e as WorkspaceError).code, "invalid_invitation");
    }
  });

  // ── Seat limits ───────────────────────────────────────────────────────────

  test("seat limit is enforced on invitation creation", async () => {
    const owner = uid("seat-owner");
    await ensureUser(owner);

    // maxSeats = 2: owner occupies 1 → only 1 more can join
    const ws = await createWorkspace(owner, "Tiny WS", 2);
    const u1 = uid("seat-u1");
    const u2 = uid("seat-u2");
    await ensureUser(u1);
    await ensureUser(u2);

    const { token: t1 } = await createInvitation(owner, ws.id, "u1@ex.com");
    await acceptInvitation(t1, u1);

    // Now at capacity — next invitation should fail
    try {
      await createInvitation(owner, ws.id, "u2@ex.com");
      assert.fail("Should have thrown seat_limit_exceeded");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError);
      assert.equal((e as WorkspaceError).code, "seat_limit_exceeded");
    }
  });

  // ── Role enforcement ──────────────────────────────────────────────────────

  test("regular member cannot promote themselves", async () => {
    const owner = uid("promo-owner");
    const member = uid("promo-member");
    await ensureUser(owner);
    await ensureUser(member);
    const ws = await createWorkspace(owner, "Promo WS", 5);
    const { token } = await createInvitation(owner, ws.id, "m@ex.com");
    await acceptInvitation(token, member);

    try {
      await promoteToAdmin(member, ws.id, member); // self-promote
      assert.fail("Should have thrown");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError);
    }
  });

  test("only owner can transfer ownership", async () => {
    const owner = uid("tf-owner");
    const member = uid("tf-member");
    await ensureUser(owner);
    await ensureUser(member);
    const ws = await createWorkspace(owner, "Transfer WS", 5);
    const { token } = await createInvitation(owner, ws.id, "t@ex.com");
    await acceptInvitation(token, member);

    // Admin tries to transfer (fails)
    await promoteToAdmin(owner, ws.id, member); // make member admin first
    try {
      await transferOwnership(member, ws.id, owner);
      assert.fail("Admin should not be able to transfer ownership");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError);
      assert.equal((e as WorkspaceError).code, "forbidden");
    }
  });

  test("the only owner cannot be removed", async () => {
    const owner = uid("sole-owner");
    await ensureUser(owner);
    const ws = await createWorkspace(owner, "Sole Owner WS", 5);

    try {
      await removeMember(owner, ws.id, owner);
      assert.fail("Should have thrown cannot_remove_only_owner");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError);
      assert.equal((e as WorkspaceError).code, "cannot_remove_only_owner");
    }
  });

  // ── Ownership transfer ────────────────────────────────────────────────────

  test("ownership transfer succeeds and new owner can act as owner", async () => {
    const owner = uid("tf2-owner");
    const newOwner = uid("tf2-new-owner");
    await ensureUser(owner);
    await ensureUser(newOwner);
    const ws = await createWorkspace(owner, "Transfer Success WS", 5);
    const { token } = await createInvitation(owner, ws.id, "new@ex.com");
    await acceptInvitation(token, newOwner);

    await transferOwnership(owner, ws.id, newOwner);

    // Previous owner should now be admin
    const members = await listMembers(newOwner, ws.id);
    const prevOwner = members.find((m) => m.userId === owner)!;
    const currOwner = members.find((m) => m.userId === newOwner)!;

    assert.equal(prevOwner?.role, "admin", "Previous owner should be demoted to admin");
    assert.equal(currOwner?.role, "owner", "New owner should have owner role");
  });

  // ── Cross-workspace ───────────────────────────────────────────────────────

  test("cross-workspace member access fails", async () => {
    const o1 = uid("cross-o1");
    const o2 = uid("cross-o2");
    await ensureUser(o1);
    await ensureUser(o2);
    const ws1 = await createWorkspace(o1, "WS One", 5);
    const ws2 = await createWorkspace(o2, "WS Two", 5);

    // o1 should not be able to list members of ws2
    try {
      await listMembers(o1, ws2.id);
      assert.fail("Cross-workspace listMembers must throw");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError);
      assert.equal((e as WorkspaceError).code, "forbidden");
    }
  });

  // ── Cannot transfer to non-member ─────────────────────────────────────────

  test("ownership transfer to non-member fails", async () => {
    const owner = uid("tf3-owner");
    await ensureUser(owner);
    const ws = await createWorkspace(owner, "Transfer Fail WS", 5);

    try {
      await transferOwnership(owner, ws.id, OUTSIDER);
      assert.fail("Should have thrown cannot_transfer_to_non_member");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError);
      assert.equal((e as WorkspaceError).code, "cannot_transfer_to_non_member");
    }
  });
});
