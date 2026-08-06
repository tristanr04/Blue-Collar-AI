/**
 * Repository for business workspaces.
 *
 * Every query that accesses workspace data validates that the requesting user
 * is a member (or owner) of the workspace. Cross-workspace access is rejected
 * at the repository layer, not just the route layer.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, ne } from "drizzle-orm";
import {
  db,
  workspacesTable,
  workspaceMembershipsTable,
  workspaceInvitationsTable,
} from "@workspace/db";
import type {
  WorkspaceRecord,
  WorkspaceMembershipRecord,
  WorkspaceInvitationRecord,
} from "@workspace/db";

export type { WorkspaceRecord, WorkspaceMembershipRecord, WorkspaceInvitationRecord };

export class WorkspaceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "forbidden"
      | "seat_limit_exceeded"
      | "already_member"
      | "invalid_invitation"
      | "invitation_expired"
      | "invitation_already_used"
      | "cannot_remove_only_owner"
      | "cannot_transfer_to_non_member",
  ) {
    super(message);
  }
}

const INVITATION_DAYS = 7;

function tokenHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

// ─── Workspace CRUD ───────────────────────────────────────────────────────────

export async function createWorkspace(
  ownerId: string,
  name: string,
  maxSeats = 5,
): Promise<WorkspaceRecord> {
  return db.transaction(async (tx) => {
    const [ws] = await tx
      .insert(workspacesTable)
      .values({ ownerId, name, maxSeats })
      .returning();
    if (!ws) throw new Error("Workspace insert failed.");

    // The creator is automatically an owner member
    await tx.insert(workspaceMembershipsTable).values({
      workspaceId: ws.id,
      userId: ownerId,
      role: "owner",
      status: "active",
      joinedAt: new Date(),
    });

    return ws;
  });
}

export async function getWorkspace(
  requestingUserId: string,
  workspaceId: string,
): Promise<WorkspaceRecord> {
  await assertMember(requestingUserId, workspaceId);
  const [ws] = await db
    .select()
    .from(workspacesTable)
    .where(eq(workspacesTable.id, workspaceId))
    .limit(1);
  if (!ws) throw new WorkspaceError("Workspace not found.", "not_found");
  return ws;
}

export async function listUserWorkspaces(userId: string): Promise<WorkspaceRecord[]> {
  const memberships = await db
    .select({ workspaceId: workspaceMembershipsTable.workspaceId })
    .from(workspaceMembershipsTable)
    .where(
      and(
        eq(workspaceMembershipsTable.userId, userId),
        eq(workspaceMembershipsTable.status, "active"),
      ),
    );

  if (memberships.length === 0) return [];

  const ids = memberships.map((m) => m.workspaceId);
  return db
    .select()
    .from(workspacesTable)
    .where(
      and(
        ...ids.map((id) => eq(workspacesTable.id, id)),
      ),
    );
}

// ─── Members ──────────────────────────────────────────────────────────────────

export async function listMembers(
  requestingUserId: string,
  workspaceId: string,
): Promise<WorkspaceMembershipRecord[]> {
  await assertMember(requestingUserId, workspaceId);
  return db
    .select()
    .from(workspaceMembershipsTable)
    .where(
      and(
        eq(workspaceMembershipsTable.workspaceId, workspaceId),
        ne(workspaceMembershipsTable.status, "removed"),
      ),
    );
}

/** Assert requesting user is an active member; returns membership record. */
async function assertMember(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceMembershipRecord> {
  const [m] = await db
    .select()
    .from(workspaceMembershipsTable)
    .where(
      and(
        eq(workspaceMembershipsTable.workspaceId, workspaceId),
        eq(workspaceMembershipsTable.userId, userId),
        eq(workspaceMembershipsTable.status, "active"),
      ),
    )
    .limit(1);
  if (!m) throw new WorkspaceError("You are not a member of this workspace.", "forbidden");
  return m;
}

/** Assert requesting user has owner or admin role. */
async function assertAdminOrOwner(userId: string, workspaceId: string): Promise<void> {
  const m = await assertMember(userId, workspaceId);
  if (m.role !== "owner" && m.role !== "admin") {
    throw new WorkspaceError("Only owners and admins can perform this action.", "forbidden");
  }
}

/** Assert requesting user has owner role. */
async function assertOwner(userId: string, workspaceId: string): Promise<void> {
  const m = await assertMember(userId, workspaceId);
  if (m.role !== "owner") {
    throw new WorkspaceError("Only the workspace owner can perform this action.", "forbidden");
  }
}

// ─── Invitations ──────────────────────────────────────────────────────────────

export async function createInvitation(
  inviterUserId: string,
  workspaceId: string,
  email: string,
  role: "admin" | "member" = "member",
): Promise<{ token: string; invitation: WorkspaceInvitationRecord }> {
  await assertAdminOrOwner(inviterUserId, workspaceId);

  // Check seat limit
  const [ws] = await db
    .select()
    .from(workspacesTable)
    .where(eq(workspacesTable.id, workspaceId))
    .limit(1);
  if (!ws) throw new WorkspaceError("Workspace not found.", "not_found");

  const [{ activeCount }] = await db
    .select({ activeCount: count() })
    .from(workspaceMembershipsTable)
    .where(
      and(
        eq(workspaceMembershipsTable.workspaceId, workspaceId),
        eq(workspaceMembershipsTable.status, "active"),
      ),
    );

  if (activeCount >= ws.maxSeats) {
    throw new WorkspaceError(
      `Workspace is at its seat limit of ${ws.maxSeats}.`,
      "seat_limit_exceeded",
    );
  }

  const token = generateToken();
  const hash = tokenHash(token);
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);

  const [inv] = await db
    .insert(workspaceInvitationsTable)
    .values({ workspaceId, inviterUserId, email, role, tokenHash: hash, expiresAt })
    .returning();

  if (!inv) throw new Error("Invitation insert failed.");

  return { token, invitation: inv };
}

export async function acceptInvitation(
  token: string,
  userId: string,
): Promise<WorkspaceMembershipRecord> {
  const hash = tokenHash(token);
  const [inv] = await db
    .select()
    .from(workspaceInvitationsTable)
    .where(eq(workspaceInvitationsTable.tokenHash, hash))
    .limit(1);

  if (!inv || inv.status !== "pending") {
    throw new WorkspaceError("Invitation is invalid or has already been used.", "invalid_invitation");
  }
  if (inv.expiresAt < new Date()) {
    throw new WorkspaceError("Invitation has expired.", "invitation_expired");
  }

  // Check seat limit
  const [ws] = await db
    .select()
    .from(workspacesTable)
    .where(eq(workspacesTable.id, inv.workspaceId))
    .limit(1);
  if (!ws) throw new WorkspaceError("Workspace not found.", "not_found");

  const [{ activeCount }] = await db
    .select({ activeCount: count() })
    .from(workspaceMembershipsTable)
    .where(
      and(
        eq(workspaceMembershipsTable.workspaceId, inv.workspaceId),
        eq(workspaceMembershipsTable.status, "active"),
      ),
    );
  if (activeCount >= ws.maxSeats) {
    throw new WorkspaceError(`Workspace is at its seat limit of ${ws.maxSeats}.`, "seat_limit_exceeded");
  }

  return db.transaction(async (tx) => {
    const now = new Date();

    await tx
      .update(workspaceInvitationsTable)
      .set({ status: "accepted", acceptedAt: now, updatedAt: now })
      .where(eq(workspaceInvitationsTable.id, inv.id));

    // Upsert membership (handle case where user was previously removed)
    const [existing] = await tx
      .select()
      .from(workspaceMembershipsTable)
      .where(
        and(
          eq(workspaceMembershipsTable.workspaceId, inv.workspaceId),
          eq(workspaceMembershipsTable.userId, userId),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await tx
        .update(workspaceMembershipsTable)
        .set({ status: "active", role: inv.role, joinedAt: now, updatedAt: now })
        .where(eq(workspaceMembershipsTable.id, existing.id))
        .returning();
      return updated!;
    }

    const [created] = await tx
      .insert(workspaceMembershipsTable)
      .values({
        workspaceId: inv.workspaceId,
        userId,
        role: inv.role,
        status: "active",
        joinedAt: now,
      })
      .returning();
    return created!;
  });
}

export async function removeMember(
  requestingUserId: string,
  workspaceId: string,
  targetUserId: string,
): Promise<void> {
  await assertAdminOrOwner(requestingUserId, workspaceId);

  // Find the target membership
  const [target] = await db
    .select()
    .from(workspaceMembershipsTable)
    .where(
      and(
        eq(workspaceMembershipsTable.workspaceId, workspaceId),
        eq(workspaceMembershipsTable.userId, targetUserId),
        eq(workspaceMembershipsTable.status, "active"),
      ),
    )
    .limit(1);

  if (!target) throw new WorkspaceError("Member not found.", "not_found");
  if (target.role === "owner") {
    // Ensure there's at least one other owner before removing
    const [{ ownerCount }] = await db
      .select({ ownerCount: count() })
      .from(workspaceMembershipsTable)
      .where(
        and(
          eq(workspaceMembershipsTable.workspaceId, workspaceId),
          eq(workspaceMembershipsTable.role, "owner"),
          eq(workspaceMembershipsTable.status, "active"),
        ),
      );
    if (ownerCount <= 1) {
      throw new WorkspaceError(
        "The only workspace owner cannot be removed. Transfer ownership first.",
        "cannot_remove_only_owner",
      );
    }
  }

  await db
    .update(workspaceMembershipsTable)
    .set({ status: "removed", updatedAt: new Date() })
    .where(eq(workspaceMembershipsTable.id, target.id));
}

export async function promoteToAdmin(
  requestingUserId: string,
  workspaceId: string,
  targetUserId: string,
): Promise<void> {
  await assertOwner(requestingUserId, workspaceId);
  const [target] = await db
    .select()
    .from(workspaceMembershipsTable)
    .where(
      and(
        eq(workspaceMembershipsTable.workspaceId, workspaceId),
        eq(workspaceMembershipsTable.userId, targetUserId),
        eq(workspaceMembershipsTable.status, "active"),
      ),
    )
    .limit(1);
  if (!target) throw new WorkspaceError("Member not found.", "not_found");
  // Members cannot promote themselves
  if (requestingUserId === targetUserId) {
    throw new WorkspaceError("You cannot promote yourself.", "forbidden");
  }
  await db
    .update(workspaceMembershipsTable)
    .set({ role: "admin", updatedAt: new Date() })
    .where(eq(workspaceMembershipsTable.id, target.id));
}

export async function transferOwnership(
  currentOwnerId: string,
  workspaceId: string,
  newOwnerId: string,
): Promise<void> {
  await assertOwner(currentOwnerId, workspaceId);

  const [newOwnerMembership] = await db
    .select()
    .from(workspaceMembershipsTable)
    .where(
      and(
        eq(workspaceMembershipsTable.workspaceId, workspaceId),
        eq(workspaceMembershipsTable.userId, newOwnerId),
        eq(workspaceMembershipsTable.status, "active"),
      ),
    )
    .limit(1);

  if (!newOwnerMembership) {
    throw new WorkspaceError(
      "New owner must be an active member of the workspace.",
      "cannot_transfer_to_non_member",
    );
  }

  await db.transaction(async (tx) => {
    const now = new Date();
    // Demote current owner to admin
    await tx
      .update(workspaceMembershipsTable)
      .set({ role: "admin", updatedAt: now })
      .where(
        and(
          eq(workspaceMembershipsTable.workspaceId, workspaceId),
          eq(workspaceMembershipsTable.userId, currentOwnerId),
        ),
      );
    // Promote new owner
    await tx
      .update(workspaceMembershipsTable)
      .set({ role: "owner", updatedAt: now })
      .where(eq(workspaceMembershipsTable.id, newOwnerMembership.id));
    // Update workspace owner_id
    await tx
      .update(workspacesTable)
      .set({ ownerId: newOwnerId, updatedAt: now })
      .where(eq(workspacesTable.id, workspaceId));
  });
}

/** Revoke a pending invitation. */
export async function revokeInvitation(
  requestingUserId: string,
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  await assertAdminOrOwner(requestingUserId, workspaceId);
  await db
    .update(workspaceInvitationsTable)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(
      and(
        eq(workspaceInvitationsTable.id, invitationId),
        eq(workspaceInvitationsTable.workspaceId, workspaceId),
        eq(workspaceInvitationsTable.status, "pending"),
      ),
    );
}
