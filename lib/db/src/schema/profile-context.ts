import { boolean, date, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import { usersTable } from "./financial";

export const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
] as const;

export const taxFilingStatuses = [
  "Single",
  "Married Filing Jointly",
  "Married Filing Separately",
  "Head of Household",
] as const;

export const profileContextTable = pgTable(
  "profile_context",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    birthDate: date("birth_date", { mode: "string" }),
    stateCode: varchar("state_code", { length: 2 }),
    taxFilingStatus: text("tax_filing_status").notNull().default("Single"),
    qualifyingChildren: integer("qualifying_children").notNull().default(0),
    otherDependents: integer("other_dependents").notNull().default(0),
    spouseHasIncome: boolean("spouse_has_income").notNull().default(false),
    additionalAnnualIncome: integer("additional_annual_income").notNull().default(0),
    annualPreTaxDeductions: integer("annual_pre_tax_deductions").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("profile_context_user_unique").on(table.userId)],
);

const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

function ageOnDate(birthDate: string, asOf = todayUtc()): number {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  let age = asOf.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    asOf.getUTCMonth() < birth.getUTCMonth() ||
    (asOf.getUTCMonth() === birth.getUTCMonth() && asOf.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Birth date must use YYYY-MM-DD.")
  .refine((value) => Number.isFinite(new Date(`${value}T00:00:00Z`).getTime()), "Birth date is invalid.")
  .refine((value) => ageOnDate(value) >= 18, "User must be at least 18.")
  .refine((value) => ageOnDate(value) <= 120, "Birth date is outside the supported range.");

/** Validated input accepted by upsertProfileContextForUser. */
export const insertProfileContextSchema = z.object({
  birthDate: birthDateSchema.nullable().optional(),
  stateCode: z.enum(US_STATE_CODES).nullable().optional(),
  taxFilingStatus: z.enum(taxFilingStatuses).default("Single"),
  qualifyingChildren: z.number().int().min(0).max(20).default(0),
  otherDependents: z.number().int().min(0).max(20).default(0),
  spouseHasIncome: z.boolean().default(false),
  additionalAnnualIncome: z.number().int().min(0).max(100_000_000).default(0),
  annualPreTaxDeductions: z.number().int().min(0).max(100_000_000).default(0),
});

export type ProfileContext = typeof profileContextTable.$inferSelect;
