import { and, desc, eq, isNull } from "drizzle-orm";
import {
  assetsTable,
  billsTable,
  db,
  debtsTable,
  insertAssetSchema,
  insertBillSchema,
  insertDebtSchema,
  insertPaystubSchema,
  insertProfileSchema,
  paystubsTable,
  profilesTable,
  usersTable,
} from "@workspace/db";

export interface UserIdentityInput {
  userId: string;
  email?: string | null;
  displayName?: string | null;
}

export async function ensureUser(identity: UserIdentityInput): Promise<void> {
  await db
    .insert(usersTable)
    .values({
      id: identity.userId,
      email: identity.email ?? null,
      displayName: identity.displayName ?? null,
    })
    .onConflictDoUpdate({
      target: usersTable.id,
      set: {
        email: identity.email ?? null,
        displayName: identity.displayName ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function getFinancialSnapshot(userId: string) {
  const [profile, paystubs, debts, bills, assets] = await Promise.all([
    db.query.profilesTable.findFirst({
      where: eq(profilesTable.userId, userId),
    }),
    db
      .select()
      .from(paystubsTable)
      .where(and(eq(paystubsTable.userId, userId), isNull(paystubsTable.deletedAt)))
      .orderBy(desc(paystubsTable.payDate)),
    db
      .select()
      .from(debtsTable)
      .where(and(eq(debtsTable.userId, userId), isNull(debtsTable.deletedAt)))
      .orderBy(desc(debtsTable.updatedAt)),
    db
      .select()
      .from(billsTable)
      .where(and(eq(billsTable.userId, userId), isNull(billsTable.deletedAt)))
      .orderBy(desc(billsTable.updatedAt)),
    db
      .select()
      .from(assetsTable)
      .where(and(eq(assetsTable.userId, userId), isNull(assetsTable.deletedAt)))
      .orderBy(desc(assetsTable.updatedAt)),
  ]);

  return { profile: profile ?? null, paystubs, debts, bills, assets };
}

export async function upsertProfile(userId: string, rawInput: unknown) {
  const input = insertProfileSchema.parse(rawInput);
  const existing = await db.query.profilesTable.findFirst({
    where: eq(profilesTable.userId, userId),
    columns: { id: true },
  });

  if (existing) {
    const [updated] = await db
      .update(profilesTable)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(profilesTable.id, existing.id), eq(profilesTable.userId, userId)))
      .returning();
    return updated;
  }

  const [created] = await db.insert(profilesTable).values({ ...input, userId }).returning();
  return created;
}

export async function createPaystub(userId: string, rawInput: unknown) {
  const input = insertPaystubSchema.parse(rawInput);
  const [created] = await db.insert(paystubsTable).values({ ...input, userId }).returning();
  return created;
}

export async function createDebt(userId: string, rawInput: unknown) {
  const input = insertDebtSchema.parse(rawInput);
  const [created] = await db.insert(debtsTable).values({ ...input, userId }).returning();
  return created;
}

export async function createBill(userId: string, rawInput: unknown) {
  const input = insertBillSchema.parse(rawInput);
  const [created] = await db.insert(billsTable).values({ ...input, userId }).returning();
  return created;
}

export async function createAsset(userId: string, rawInput: unknown) {
  const input = insertAssetSchema.parse(rawInput);
  const [created] = await db.insert(assetsTable).values({ ...input, userId }).returning();
  return created;
}

export async function softDeleteFinancialRecord(
  userId: string,
  section: "paystubs" | "debts" | "bills" | "assets",
  recordId: string,
): Promise<boolean> {
  const deletedAt = new Date();
  const tables = {
    paystubs: paystubsTable,
    debts: debtsTable,
    bills: billsTable,
    assets: assetsTable,
  } as const;
  const table = tables[section];

  const rows = await db
    .update(table)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(and(eq(table.id, recordId), eq(table.userId, userId), isNull(table.deletedAt)))
    .returning({ id: table.id });

  return rows.length > 0;
}
