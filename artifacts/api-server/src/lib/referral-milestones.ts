import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { referralEventsTable, referralsTable } from "@workspace/db/schema";

export const referralMilestones = [
  "onboarding_completed",
  "first_scan",
  "dashboard_reached",
  "subscription_started",
  "subscription_canceled",
] as const;

export type ReferralMilestone = (typeof referralMilestones)[number];

const milestoneColumns = {
  onboarding_completed: "onboardingCompletedAt",
  first_scan: "firstScanAt",
  dashboard_reached: "dashboardReachedAt",
  subscription_started: "subscriptionStartedAt",
  subscription_canceled: "canceledAt",
} as const;

/**
 * Records a lifecycle milestone for a referred account.
 *
 * The event key is stable per referral + milestone, so retries are harmless.
 * Activation occurs only after onboarding, a first scan, and a dashboard visit.
 */
export async function recordReferralMilestone(
  referredUserId: string,
  milestone: ReferralMilestone,
  metadata: Record<string, unknown> = {},
) {
  const [referral] = await db
    .select()
    .from(referralsTable)
    .where(eq(referralsTable.referredUserId, referredUserId))
    .limit(1);

  // Most users will not be referrals. Treat that as a successful no-op so
  // product routes can safely call this after their primary work completes.
  if (!referral || referral.invalidatedAt) {
    return { tracked: false, activated: false, referralId: null } as const;
  }

  const now = new Date();
  const column = milestoneColumns[milestone];
  const next = {
    onboardingCompletedAt:
      milestone === "onboarding_completed" ? referral.onboardingCompletedAt ?? now : referral.onboardingCompletedAt,
    firstScanAt: milestone === "first_scan" ? referral.firstScanAt ?? now : referral.firstScanAt,
    dashboardReachedAt:
      milestone === "dashboard_reached" ? referral.dashboardReachedAt ?? now : referral.dashboardReachedAt,
    subscriptionStartedAt:
      milestone === "subscription_started" ? referral.subscriptionStartedAt ?? now : referral.subscriptionStartedAt,
    canceledAt:
      milestone === "subscription_canceled" ? referral.canceledAt ?? now : referral.canceledAt,
  };

  const shouldActivate = Boolean(
    next.onboardingCompletedAt && next.firstScanAt && next.dashboardReachedAt,
  );
  const activatedAt = referral.activatedAt ?? (shouldActivate ? now : null);

  let currentStatus = referral.currentStatus;
  let rewardStatus = referral.rewardStatus;
  if (milestone === "subscription_canceled") {
    currentStatus = "canceled";
  } else if (milestone === "subscription_started") {
    currentStatus = "subscription_started";
    rewardStatus = rewardStatus === "not_eligible" ? "eligible" : rewardStatus;
  } else if (activatedAt) {
    currentStatus = "activated";
  } else if (milestone === "dashboard_reached") {
    currentStatus = "dashboard_reached";
  } else if (milestone === "first_scan") {
    currentStatus = "first_scan";
  } else if (milestone === "onboarding_completed") {
    currentStatus = "onboarding_completed";
  }

  const updated = await db.transaction(async (tx) => {
    await tx
      .insert(referralEventsTable)
      .values({
        referralId: referral.id,
        eventType: milestone,
        idempotencyKey: `${milestone}:${referral.id}`,
        actorUserId: referredUserId,
        source: "product_lifecycle",
        metadata,
      })
      .onConflictDoNothing({ target: referralEventsTable.idempotencyKey });

    if (activatedAt && !referral.activatedAt) {
      await tx
        .insert(referralEventsTable)
        .values({
          referralId: referral.id,
          eventType: "activated",
          idempotencyKey: `activated:${referral.id}`,
          actorUserId: referredUserId,
          source: "product_lifecycle",
        })
        .onConflictDoNothing({ target: referralEventsTable.idempotencyKey });
    }

    const [row] = await tx
      .update(referralsTable)
      .set({
        [column]: next[column],
        activatedAt,
        currentStatus,
        rewardStatus,
        updatedAt: now,
      })
      .where(
        and(
          eq(referralsTable.id, referral.id),
          eq(referralsTable.referredUserId, referredUserId),
        ),
      )
      .returning();

    if (!row) throw new Error("Referral milestone update returned no row.");
    return row;
  });

  return {
    tracked: true,
    activated: Boolean(updated.activatedAt),
    referralId: updated.id,
  } as const;
}
