import { pgEnum, pgTable, text, timestamp, integer, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const subscriptionPlanEnum = pgEnum("subscription_plan", ["free", "pro", "business"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing", "active", "past_due", "canceled", "incomplete", "unpaid",
]);
export const usageKindEnum = pgEnum("usage_kind", ["document_scan", "ai_question", "tax_scenario", "cloud_document"]);

export const subscriptionsTable = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  plan: subscriptionPlanEnum("plan").notNull().default("free"),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  provider: text("provider").notNull().default("manual"),
  providerCustomerId: text("provider_customer_id"),
  providerSubscriptionId: text("provider_subscription_id"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodStartsAt: timestamp("current_period_starts_at", { withTimezone: true }),
  currentPeriodEndsAt: timestamp("current_period_ends_at", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdUnique: uniqueIndex("subscriptions_user_id_unique").on(table.userId),
  providerSubIndex: index("subscriptions_provider_subscription_idx").on(table.providerSubscriptionId),
}));

export const subscriptionUsageTable = pgTable("subscription_usage", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  kind: usageKindEnum("kind").notNull(),
  quantity: integer("quantity").notNull().default(1),
  periodKey: text("period_key").notNull(),
  idempotencyKey: text("idempotency_key"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userPeriodIndex: index("subscription_usage_user_period_idx").on(table.userId, table.periodKey, table.kind),
  idempotencyUnique: uniqueIndex("subscription_usage_idempotency_unique").on(table.idempotencyKey),
}));

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable);
export const insertSubscriptionUsageSchema = createInsertSchema(subscriptionUsageTable);
export type Subscription = typeof subscriptionsTable.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type SubscriptionUsage = typeof subscriptionUsageTable.$inferSelect;
export type InsertSubscriptionUsage = z.infer<typeof insertSubscriptionUsageSchema>;
