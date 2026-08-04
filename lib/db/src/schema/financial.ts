import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const assetTypeEnum = pgEnum("asset_type", ["Cash", "Investment", "Other"]);
export const documentStatusEnum = pgEnum("document_status", [
  "Pending Review",
  "Processed",
  "Rejected",
]);
export const importStatusEnum = pgEnum("import_status", [
  "pending",
  "confirmed",
  "reverted",
  "failed",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(), // Verified Clerk user ID
  email: text("email"),
  displayName: text("display_name"),
  acceptedAiDisclosureAt: timestamp("accepted_ai_disclosure_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
});

export const profilesTable = pgTable(
  "profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    payFrequency: text("pay_frequency").notNull().default("Weekly"),
    hourlyRate: doublePrecision("hourly_rate").notNull().default(0),
    filingContext: text("filing_context").notNull().default("Single"),
    hasCompletedOnboarding: boolean("has_completed_onboarding").notNull().default(false),
    ...timestamps,
  },
  (table) => [uniqueIndex("profiles_user_id_unique").on(table.userId)],
);

export const paystubsTable = pgTable(
  "paystubs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    employer: text("employer").notNull().default(""),
    payDate: timestamp("pay_date", { withTimezone: true }).notNull(),
    regularHours: doublePrecision("regular_hours").notNull().default(0),
    overtimeHours: doublePrecision("overtime_hours").notNull().default(0),
    doubleTimeHours: doublePrecision("double_time_hours").notNull().default(0),
    perDiem: doublePrecision("per_diem").notNull().default(0),
    bonus: doublePrecision("bonus").notNull().default(0),
    grossPay: doublePrecision("gross_pay").notNull().default(0),
    netPay: doublePrecision("net_pay").notNull().default(0),
    taxes: doublePrecision("taxes").notNull().default(0),
    deductions: doublePrecision("deductions").notNull().default(0),
    sourceDocumentId: uuid("source_document_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("paystubs_user_date_idx").on(table.userId, table.payDate),
    index("paystubs_user_active_idx").on(table.userId, table.deletedAt),
  ],
);

export const debtsTable = pgTable(
  "debts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    institutionName: text("institution_name"),
    accountType: text("account_type"),
    lastFour: text("last_four"),
    balance: doublePrecision("balance").notNull().default(0),
    interestRate: doublePrecision("interest_rate").notNull().default(0),
    minimumPayment: doublePrecision("minimum_payment").notNull().default(0),
    creditLimit: doublePrecision("credit_limit"),
    isRevolving: boolean("is_revolving").notNull().default(false),
    sourceDocumentId: uuid("source_document_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("debts_user_active_idx").on(table.userId, table.deletedAt),
    index("debts_user_institution_idx").on(table.userId, table.institutionName),
    index("debts_user_last_four_idx").on(table.userId, table.lastFour),
  ],
);

export const billsTable = pgTable(
  "bills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    providerNormalized: text("provider_normalized"),
    amount: doublePrecision("amount").notNull().default(0),
    dueDay: integer("due_day").notNull().default(1),
    isAutoPay: boolean("is_auto_pay").notNull().default(false),
    sourceDocumentId: uuid("source_document_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("bills_user_active_idx").on(table.userId, table.deletedAt)],
);

export const assetsTable = pgTable(
  "assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: assetTypeEnum("type").notNull(),
    value: doublePrecision("value").notNull().default(0),
    institutionName: text("institution_name"),
    accountType: text("account_type"),
    lastFour: text("last_four"),
    sourceDocumentId: uuid("source_document_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("assets_user_active_idx").on(table.userId, table.deletedAt),
    index("assets_user_institution_idx").on(table.userId, table.institutionName),
    index("assets_user_last_four_idx").on(table.userId, table.lastFour),
  ],
);

export const scannedDocumentsTable = pgTable(
  "scanned_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    fileFingerprint: text("file_fingerprint").notNull(),
    mimeType: text("mime_type").notNull(),
    documentType: text("document_type").notNull().default("Unknown"),
    status: documentStatusEnum("status").notNull().default("Pending Review"),
    classificationConfidence: integer("classification_confidence"),
    institutionNormalized: text("institution_normalized"),
    extractionMetadata: jsonb("extraction_metadata").$type<Record<string, unknown>>(),
    securityWarnings: jsonb("security_warnings").$type<string[]>().default([]),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("documents_user_fingerprint_unique").on(table.userId, table.fileFingerprint),
    index("documents_user_status_idx").on(table.userId, table.status),
  ],
);

export const importJobsTable = pgTable(
  "import_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => scannedDocumentsTable.id, { onDelete: "cascade" }),
    status: importStatusEnum("status").notNull().default("pending"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (table) => [index("import_jobs_user_status_idx").on(table.userId, table.status)],
);

export const financialChangesTable = pgTable(
  "financial_changes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    importJobId: uuid("import_job_id")
      .notNull()
      .references(() => importJobsTable.id, { onDelete: "cascade" }),
    destinationSection: text("destination_section").notNull(),
    recordId: uuid("record_id").notNull(),
    field: text("field").notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    userConfirmed: boolean("user_confirmed").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("financial_changes_import_idx").on(table.importJobId)],
);

export const documentAccountLinksTable = pgTable(
  "document_account_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => scannedDocumentsTable.id, { onDelete: "cascade" }),
    destinationSection: text("destination_section").notNull(),
    recordId: uuid("record_id").notNull(),
    matchScore: integer("match_score").notNull(),
    userConfirmed: boolean("user_confirmed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_account_link_unique").on(
      table.userId,
      table.documentId,
      table.destinationSection,
      table.recordId,
    ),
  ],
);

export const userPreferencesTable = pgTable(
  "user_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [uniqueIndex("user_preferences_user_unique").on(table.userId)],
);

// ─── Migration Jobs (idempotency) ─────────────────────────────────────────────
//
// Each row represents one bulk-migration attempt.  The UNIQUE constraint on
// (user_id, idempotency_key) ensures a client-generated UUID cannot produce
// duplicate records even on network retries.
//
// Status lifecycle:
//   pending → committed  (all records created in a DB transaction)
//   pending → failed     (transaction rolled back; row updated by the catch path)
//
// A 'pending' row that is older than 10 minutes is considered stale (server
// crashed during the migration). The status endpoint surfaces isStale=true so
// the client can offer a fresh retry.

export const migrationJobsTable = pgTable(
  "migration_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull(),
    status: text("status").notNull().default("pending"), // 'pending' | 'committed' | 'failed'
    result: jsonb("result").$type<MigrationResult | null>().default(null),
    errorMessage: text("error_message"),
    recordCounts: jsonb("record_counts")
      .$type<Record<string, number>>()
      .default({}),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("migration_jobs_user_key_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("migration_jobs_user_status_idx").on(table.userId, table.status),
  ],
);

export interface MigrationIdMap {
  clientId: string;
  serverId: string;
}

export interface MigrationResult {
  paystubs: MigrationIdMap[];
  debts: MigrationIdMap[];
  bills: MigrationIdMap[];
  assets: MigrationIdMap[];
}

export const aiUsageRecordsTable = pgTable(
  "ai_usage_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCostUsd: doublePrecision("estimated_cost_usd"),
    succeeded: boolean("succeeded").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("ai_usage_user_created_idx").on(table.userId, table.createdAt)],
);

export const usersRelations = relations(usersTable, ({ one, many }) => ({
  profile: one(profilesTable),
  paystubs: many(paystubsTable),
  debts: many(debtsTable),
  bills: many(billsTable),
  assets: many(assetsTable),
  documents: many(scannedDocumentsTable),
  importJobs: many(importJobsTable),
}));

export const insertProfileSchema = createInsertSchema(profilesTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export const selectProfileSchema = createSelectSchema(profilesTable);
export const insertPaystubSchema = createInsertSchema(paystubsTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});
export const insertDebtSchema = createInsertSchema(debtsTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});
export const insertBillSchema = createInsertSchema(billsTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});
export const insertAssetSchema = createInsertSchema(assetsTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type UserRecord = typeof usersTable.$inferSelect;
export type ProfileRecord = typeof profilesTable.$inferSelect;
export type PaystubRecord = typeof paystubsTable.$inferSelect;
export type DebtRecord = typeof debtsTable.$inferSelect;
export type BillRecord = typeof billsTable.$inferSelect;
export type AssetRecord = typeof assetsTable.$inferSelect;
export type ScannedDocumentRecord = typeof scannedDocumentsTable.$inferSelect;
