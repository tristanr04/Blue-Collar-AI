import { eq } from "drizzle-orm";
import {
  db,
  insertProfileContextSchema,
  profileContextTable,
  type ProfileContext,
} from "@workspace/db";

export async function getProfileContextForUser(userId: string): Promise<ProfileContext | null> {
  const record = await db.query.profileContextTable.findFirst({
    where: eq(profileContextTable.userId, userId),
  });

  return record ?? null;
}

export async function upsertProfileContextForUser(
  userId: string,
  input: unknown,
): Promise<ProfileContext> {
  const parsed = insertProfileContextSchema.parse(input);

  const [record] = await db
    .insert(profileContextTable)
    .values({
      userId,
      ...parsed,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: profileContextTable.userId,
      set: {
        ...parsed,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!record) throw new Error("Profile context update did not return a record.");
  return record;
}
