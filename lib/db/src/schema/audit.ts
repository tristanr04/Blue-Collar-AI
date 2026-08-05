import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./financial";

/**
 * Append-only audit trail for security- and finance-sensitive mutations.
 *
 * Never store raw uploaded files, tokens, secrets, or full request bodies here.
 * `metadata` must contain only the minimum fields needed to explain an event.
 */
export const auditEventsTable = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    requestId: text("request_id"),
    source: text("source").notNull().default("api"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_events_user_created_idx").on(table.userId, table.createdAt),
    index("audit_events_user_entity_idx").on(table.userId, table.entityType, table.entityId),
    index("audit_events_request_idx").on(table.requestId),
  ],
);

export type AuditEventRecord = typeof auditEventsTable.$inferSelect;
