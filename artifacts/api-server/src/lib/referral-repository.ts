import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  referralCodesTable,
  referralEventsTable,
  referralsTable,
} from "@workspace/db/schema";

const ATTRIBUTION_DAYS = 30;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class ReferralError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "code_not_found"
      | "attribution_not_found"
      | "attribution_expired"
      | "already_attached"
      | "self_referral"
      | "circular_referral",
  ) {
    super(message);
  }
}

/**
 * Walk the referrer chain from `startUserId` toward the root.
 * At each step, look up the referral row where referred_user_id = currentUser.
 * If we encounter `blockedUserId` in the chain, the attachment would create a cycle.
 *
 * Capped at 50 hops to guard against pathological DB state.
 */
async function assertNoReferralCycle(
  startUserId: string,
  blockedUserId: string,
): Promise<void> {
  const MAX_DEPTH = 50;
  let currentUserId: string | null = startUserId;

  for (let depth = 0; depth < MAX_DEPTH && currentUserId !== null; depth++) {
    if (currentUserId === blockedUserId) {
      throw new ReferralError(
        "This referral would create a circular chain.",
        "circular_referral",
      );
    }

    // Find the referral row where this user was the referred party
    const [parent] = await db
      .select({ referrerUserId: referralsTable.referrerUserId })
      .from(referralsTable)
      .where(eq(referralsTable.referredUserId, currentUserId))
      .limit(1);

    currentUserId = parent?.referrerUserId ?? null;
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomCode(length = 8): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function rawAttributionToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function getOrCreateReferralCode(userId: string) {
  const [existing] = await db
    .select()
    .from(referralCodesTable)
    .where(eq(referralCodesTable.userId, userId))
    .limit(1);

  if (existing) return existing;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = randomCode();
    try {
      const [created] = await db
        .insert(referralCodesTable)
        .values({ userId, code })
        .returning();
      if (created) return created;
    } catch (error) {
      const pgCode = (error as { code?: string }).code;
      if (pgCode !== "23505") throw error;

      const [raced] = await db
        .select()
        .from(referralCodesTable)
        .where(eq(referralCodesTable.userId, userId))
        .limit(1);
      if (raced) return raced;
    }
  }

  throw new Error("Could not allocate a unique referral code.");
}

export async function startReferralAttribution(input: {
  code: string;
  anonymousVisitorId?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}) {
  const normalizedCode = input.code.trim().toUpperCase();
  const [referralCode] = await db
    .select()
    .from(referralCodesTable)
    .where(
      and(
        eq(referralCodesTable.code, normalizedCode),
        eq(referralCodesTable.isActive, true),
      ),
    )
    .limit(1);

  if (!referralCode) {
    throw new ReferralError("Referral code was not found.", "code_not_found");
  }

  const token = rawAttributionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000);

  const [referral] = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(referralsTable)
      .values({
        referralCodeId: referralCode.id,
        referrerUserId: referralCode.userId,
        attributionTokenHash: hash(token),
        anonymousVisitorIdHash: input.anonymousVisitorId
          ? hash(input.anonymousVisitorId)
          : null,
        attributionExpiresAt: expiresAt,
        attributionSource: input.source?.trim().slice(0, 80) || "referral_link",
        metadata: input.metadata ?? {},
      })
      .returning();

    if (!created) throw new Error("Referral attribution insert returned no row.");

    await tx.insert(referralEventsTable).values({
      referralId: created.id,
      eventType: "link_visited",
      idempotencyKey: `link_visited:${created.id}`,
      source: "api",
      metadata: input.metadata ?? {},
    });

    return [created] as const;
  });

  return { token, expiresAt: referral.attributionExpiresAt };
}

export async function attachReferralToUser(token: string, referredUserId: string) {
  const tokenHash = hash(token);
  const [referral] = await db
    .select()
    .from(referralsTable)
    .where(eq(referralsTable.attributionTokenHash, tokenHash))
    .limit(1);

  if (!referral) {
    throw new ReferralError("Referral attribution was not found.", "attribution_not_found");
  }
  if (referral.attributionExpiresAt.getTime() < Date.now()) {
    throw new ReferralError("Referral attribution has expired.", "attribution_expired");
  }
  if (referral.referrerUserId === referredUserId) {
    throw new ReferralError("A user cannot refer themselves.", "self_referral");
  }
  if (referral.referredUserId && referral.referredUserId !== referredUserId) {
    throw new ReferralError("Referral attribution is already attached.", "already_attached");
  }
  if (referral.referredUserId === referredUserId) return referral;

  // Guard against circular chains: walk the referrer chain upward.
  // If referredUserId appears anywhere in the chain above referrerUserId,
  // attaching would create a cycle (A→B→C→A, etc.).
  await assertNoReferralCycle(referral.referrerUserId, referredUserId);

  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(referralsTable)
      .set({
        referredUserId,
        currentStatus: "account_created",
        signupStartedAt: referral.signupStartedAt ?? now,
        accountCreatedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(referralsTable.id, referral.id),
          eq(referralsTable.attributionTokenHash, tokenHash),
        ),
      )
      .returning();

    if (!row) throw new Error("Referral attribution update returned no row.");

    await tx.insert(referralEventsTable).values({
      referralId: row.id,
      eventType: "account_created",
      idempotencyKey: `account_created:${row.id}`,
      actorUserId: referredUserId,
      source: "api",
    });

    return [row] as const;
  });

  return updated;
}

export async function getReferralDashboard(userId: string) {
  const code = await getOrCreateReferralCode(userId);
  const referrals = await db
    .select({
      id: referralsTable.id,
      currentStatus: referralsTable.currentStatus,
      rewardStatus: referralsTable.rewardStatus,
      firstVisitAt: referralsTable.firstVisitAt,
      accountCreatedAt: referralsTable.accountCreatedAt,
      activatedAt: referralsTable.activatedAt,
      subscriptionStartedAt: referralsTable.subscriptionStartedAt,
    })
    .from(referralsTable)
    .where(
      and(
        eq(referralsTable.referrerUserId, userId),
        eq(referralsTable.visibleToReferrer, true),
      ),
    )
    .orderBy(desc(referralsTable.firstVisitAt));

  const counts = referrals.reduce(
    (acc, referral) => {
      acc.visits += 1;
      if (referral.accountCreatedAt) acc.signups += 1;
      if (referral.activatedAt) acc.activated += 1;
      if (referral.subscriptionStartedAt) acc.paid += 1;
      if (referral.rewardStatus === "paid") acc.rewardsPaid += 1;
      return acc;
    },
    { visits: 0, signups: 0, activated: 0, paid: 0, rewardsPaid: 0 },
  );

  return {
    code: code.code,
    isActive: code.isActive,
    counts,
    referrals: referrals.map((referral) => ({
      id: referral.id,
      status: referral.currentStatus,
      rewardStatus: referral.rewardStatus,
      firstVisitAt: referral.firstVisitAt,
      accountCreatedAt: referral.accountCreatedAt,
      activatedAt: referral.activatedAt,
      subscriptionStartedAt: referral.subscriptionStartedAt,
    })),
  };
}
