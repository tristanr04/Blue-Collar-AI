import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const referralCodesTable = pgTable(
  "referral_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    code: text("code").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userUnique: uniqueIndex("referral_codes_user_unique").on(table.userId),
    codeUnique: uniqueIndex("referral_codes_code_unique").on(table.code),
  }),
);

export const referralsTable = pgTable(
  "referrals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    referralCodeId: uuid("referral_code_id")
      .notNull()
      .references(() => referralCodesTable.id, { onDelete: "restrict" }),
    referrerUserId: text("referrer_user_id").notNull(),
    referredUserId: text("referred_user_id"),
    attributionTokenHash: text("attribution_token_hash").notNull(),
    anonymousVisitorIdHash: text("anonymous_visitor_id_hash"),
    currentStatus: text("current_status").notNull().default("link_visited"),
    rewardStatus: text("reward_status").notNull().default("not_eligible"),
    firstVisitAt: timestamp("first_visit_at", { withTimezone: true }).notNull().defaultNow(),
    attributionExpiresAt: timestamp("attribution_expires_at", { withTimezone: true }).notNull(),
    signupStartedAt: timestamp("signup_started_at", { withTimezone: true }),
    accountCreatedAt: timestamp("account_created_at", { withTimezone: true }),
    onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
    firstScanAt: timestamp("first_scan_at", { withTimezone: true }),
    dashboardReachedAt: timestamp("dashboard_reached_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    subscriptionStartedAt: timestamp("subscription_started_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidReason: text("invalid_reason"),
    visibleToReferrer: boolean("visible_to_referrer").notNull().default(true),
    suspiciousSignals: jsonb("suspicious_signals").$type<string[]>().notNull().default([]),
    attributionSource: text("attribution_source").notNull().default("referral_link"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    attributionTokenUnique: uniqueIndex("referrals_attribution_token_unique").on(
      table.attributionTokenHash,
    ),
    referredUserUnique: uniqueIndex("referrals_referred_user_unique").on(table.referredUserId),
    referrerStatusIndex: index("referrals_referrer_status_idx").on(
      table.referrerUserId,
      table.currentStatus,
    ),
    codeIndex: index("referrals_code_idx").on(table.referralCodeId),
  }),
);

export const referralEventsTable = pgTable(
  "referral_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    referralId: uuid("referral_id")
      .notNull()
      .references(() => referralsTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    actorUserId: text("actor_user_id"),
    source: text("source").notNull().default("api"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUnique: uniqueIndex("referral_events_idempotency_unique").on(
      table.idempotencyKey,
    ),
    referralTimelineIndex: index("referral_events_timeline_idx").on(
      table.referralId,
      table.occurredAt,
    ),
  }),
);

export const referralInvitationsTable = pgTable(
  "referral_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    referrerUserId: text("referrer_user_id").notNull(),
    referralCodeId: uuid("referral_code_id")
      .notNull()
      .references(() => referralCodesTable.id, { onDelete: "restrict" }),
    normalizedEmailHash: text("normalized_email_hash").notNull(),
    maskedEmail: text("masked_email").notNull(),
    status: text("status").notNull().default("created"),
    providerMessageId: text("provider_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    duplicateInviteUnique: uniqueIndex("referral_invitations_duplicate_unique").on(
      table.referrerUserId,
      table.normalizedEmailHash,
    ),
    referrerStatusIndex: index("referral_invitations_referrer_status_idx").on(
      table.referrerUserId,
      table.status,
    ),
  }),
);

export type ReferralCode = typeof referralCodesTable.$inferSelect;
export type Referral = typeof referralsTable.$inferSelect;
export type ReferralEvent = typeof referralEventsTable.$inferSelect;
export type ReferralInvitation = typeof referralInvitationsTable.$inferSelect;
