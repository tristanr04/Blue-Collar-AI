import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./financial";

export type BackgroundJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type BackgroundJobType = "document_scan" | "ai_explanation" | "document_import";

export const backgroundJobsTable = pgTable(
  "background_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    jobType: text("job_type").$type<BackgroundJobType>().notNull(),
    status: text("status").$type<BackgroundJobStatus>().notNull().default("queued"),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown> | null>().default(null),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("background_jobs_user_key_unique").on(table.userId, table.idempotencyKey),
    index("background_jobs_ready_idx").on(table.status, table.availableAt),
    index("background_jobs_user_created_idx").on(table.userId, table.createdAt),
    index("background_jobs_lock_idx").on(table.lockedAt, table.status),
  ],
);

export type BackgroundJobRecord = typeof backgroundJobsTable.$inferSelect;
