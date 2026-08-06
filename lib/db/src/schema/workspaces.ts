import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { isNotNull } from "drizzle-orm";

export const workspacesTable = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    plan: text("plan").notNull().default("business"),
    maxSeats: integer("max_seats").notNull().default(5),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerIdx: index("workspaces_owner_idx").on(table.ownerId),
  }),
);

export const workspaceMembershipsTable = pgTable(
  "workspace_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    role: text("role").notNull().default("member"),
    status: text("status").notNull().default("active"),
    invitedEmail: text("invited_email"),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceUserUnique: uniqueIndex("workspace_memberships_workspace_user_unique")
      .on(table.workspaceId, table.userId)
      .where(isNotNull(table.userId) as any),
    workspaceIdx: index("workspace_memberships_workspace_idx").on(table.workspaceId),
    userIdx: index("workspace_memberships_user_idx").on(table.userId),
  }),
);

export const workspaceInvitationsTable = pgTable(
  "workspace_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    inviterUserId: text("inviter_user_id").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull().default("member"),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("workspace_invitations_token_hash_unique").on(table.tokenHash),
    workspaceIdx: index("workspace_invitations_workspace_idx").on(
      table.workspaceId,
      table.status,
    ),
  }),
);

export type WorkspaceRecord = typeof workspacesTable.$inferSelect;
export type WorkspaceMembershipRecord = typeof workspaceMembershipsTable.$inferSelect;
export type WorkspaceInvitationRecord = typeof workspaceInvitationsTable.$inferSelect;
