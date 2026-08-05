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
  scannedDocumentsTable,
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
  // payDate arrives as an ISO string over JSON; coerce it to Date for the
  // Drizzle timestamp column (drizzle-zod generates z.date(), not z.coerce.date()).
  const coerced =
    rawInput && typeof rawInput === "object" && "payDate" in (rawInput as object)
      ? { ...(rawInput as object), payDate: new Date((rawInput as any).payDate) }
      : rawInput;
  const input = insertPaystubSchema.parse(coerced);
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

async function softDeletePaystub(userId: string, recordId: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(paystubsTable)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(paystubsTable.id, recordId),
        eq(paystubsTable.userId, userId),
        isNull(paystubsTable.deletedAt),
      ),
    )
    .returning({ id: paystubsTable.id });
  return rows.length > 0;
}

async function softDeleteDebt(userId: string, recordId: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(debtsTable)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(eq(debtsTable.id, recordId), eq(debtsTable.userId, userId), isNull(debtsTable.deletedAt)),
    )
    .returning({ id: debtsTable.id });
  return rows.length > 0;
}

async function softDeleteBill(userId: string, recordId: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(billsTable)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(eq(billsTable.id, recordId), eq(billsTable.userId, userId), isNull(billsTable.deletedAt)),
    )
    .returning({ id: billsTable.id });
  return rows.length > 0;
}

async function softDeleteAsset(userId: string, recordId: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(assetsTable)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(eq(assetsTable.id, recordId), eq(assetsTable.userId, userId), isNull(assetsTable.deletedAt)),
    )
    .returning({ id: assetsTable.id });
  return rows.length > 0;
}

// ─── Scanned documents / fingerprints ────────────────────────────────────────

/**
 * Return the existing document record for a user + fingerprint, or null.
 * Used for server-side duplicate-document detection before AI processing.
 */
export async function checkDocumentFingerprint(userId: string, fingerprint: string) {
  return db.query.scannedDocumentsTable.findFirst({
    where: and(
      eq(scannedDocumentsTable.userId, userId),
      eq(scannedDocumentsTable.fileFingerprint, fingerprint),
      isNull(scannedDocumentsTable.deletedAt),
    ),
  });
}

/**
 * Record a processed document. The UNIQUE(user_id, file_fingerprint) constraint
 * is enforced in the DB; ON CONFLICT DO NOTHING makes this idempotent.
 * Returns the created row, or undefined on conflict.
 */
export async function createScannedDocument(
  userId: string,
  input: {
    fileFingerprint: string;
    fileName: string;
    mimeType: string;
    documentType?: string;
    classificationConfidence?: number | null;
    institutionNormalized?: string | null;
    status?: "Pending Review" | "Processed" | "Rejected";
  },
) {
  const [created] = await db
    .insert(scannedDocumentsTable)
    .values({
      userId,
      fileFingerprint: input.fileFingerprint,
      fileName: input.fileName,
      mimeType: input.mimeType,
      documentType: input.documentType ?? "Unknown",
      classificationConfidence: input.classificationConfidence ?? null,
      institutionNormalized: input.institutionNormalized ?? null,
      status: (input.status ?? "Processed") as "Pending Review" | "Processed" | "Rejected",
    })
    .onConflictDoNothing()
    .returning();
  return created; // undefined when a duplicate fingerprint was ignored
}

// ─── Update functions ─────────────────────────────────────────────────────────

export async function updatePaystub(
  userId: string,
  recordId: string,
  rawInput: unknown,
) {
  const input = insertPaystubSchema.partial().parse(rawInput);
  // payDate may arrive as an ISO string — coerce it the same way createPaystub does.
  if ("payDate" in input && typeof (input as any).payDate === "string") {
    (input as any).payDate = new Date((input as any).payDate);
  }
  const rows = await db
    .update(paystubsTable)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(
        eq(paystubsTable.id, recordId),
        eq(paystubsTable.userId, userId),
        isNull(paystubsTable.deletedAt),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function updateDebt(
  userId: string,
  recordId: string,
  rawInput: unknown,
) {
  const input = insertDebtSchema.partial().parse(rawInput);
  const rows = await db
    .update(debtsTable)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(
        eq(debtsTable.id, recordId),
        eq(debtsTable.userId, userId),
        isNull(debtsTable.deletedAt),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function updateBill(
  userId: string,
  recordId: string,
  rawInput: unknown,
) {
  const input = insertBillSchema.partial().parse(rawInput);
  const rows = await db
    .update(billsTable)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(
        eq(billsTable.id, recordId),
        eq(billsTable.userId, userId),
        isNull(billsTable.deletedAt),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function updateAsset(
  userId: string,
  recordId: string,
  rawInput: unknown,
) {
  const input = insertAssetSchema.partial().parse(rawInput);
  const rows = await db
    .update(assetsTable)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(
        eq(assetsTable.id, recordId),
        eq(assetsTable.userId, userId),
        isNull(assetsTable.deletedAt),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function softDeleteFinancialRecord(
  userId: string,
  section: "paystubs" | "debts" | "bills" | "assets",
  recordId: string,
): Promise<boolean> {
  switch (section) {
    case "paystubs":
      return softDeletePaystub(userId, recordId);
    case "debts":
      return softDeleteDebt(userId, recordId);
    case "bills":
      return softDeleteBill(userId, recordId);
    case "assets":
      return softDeleteAsset(userId, recordId);
  }
}

// ─── Single-record lookups (for timeline pre-fetch) ───────────────────────────

export async function getPaystubById(userId: string, recordId: string) {
  const [row] = await db.select().from(paystubsTable)
    .where(and(eq(paystubsTable.id, recordId), eq(paystubsTable.userId, userId), isNull(paystubsTable.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getDebtById(userId: string, recordId: string) {
  const [row] = await db.select().from(debtsTable)
    .where(and(eq(debtsTable.id, recordId), eq(debtsTable.userId, userId), isNull(debtsTable.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getBillById(userId: string, recordId: string) {
  const [row] = await db.select().from(billsTable)
    .where(and(eq(billsTable.id, recordId), eq(billsTable.userId, userId), isNull(billsTable.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getAssetById(userId: string, recordId: string) {
  const [row] = await db.select().from(assetsTable)
    .where(and(eq(assetsTable.id, recordId), eq(assetsTable.userId, userId), isNull(assetsTable.deletedAt)))
    .limit(1);
  return row ?? null;
}
