import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeSource = await readFile(
  new URL("../routes/referrals.ts", import.meta.url),
  "utf8",
);
const milestoneSource = await readFile(
  new URL("../lib/referral-milestones.ts", import.meta.url),
  "utf8",
);
const repositorySource = await readFile(
  new URL("../lib/referral-repository.ts", import.meta.url),
  "utf8",
);

test("referral lifecycle routes require verified authentication", () => {
  assert.match(routeSource, /router\.use\("\/referrals", requireAuthenticatedUser\)/);
  assert.match(routeSource, /router\.post\("\/referrals\/milestones"/);
  assert.match(routeSource, /authenticatedUserId/);
  assert.doesNotMatch(routeSource, /req\.body\.userId/);
});

test("milestone events are idempotent", () => {
  assert.match(milestoneSource, /idempotencyKey: `\$\{milestone\}:\$\{referral\.id\}`/);
  assert.match(milestoneSource, /onConflictDoNothing/);
  assert.match(milestoneSource, /idempotencyKey: `activated:\$\{referral\.id\}`/);
});

test("activation requires onboarding, first scan, and dashboard use", () => {
  assert.match(
    milestoneSource,
    /next\.onboardingCompletedAt && next\.firstScanAt && next\.dashboardReachedAt/,
  );
  assert.match(milestoneSource, /currentStatus = "activated"/);
});

test("milestone writes are scoped to the authenticated referred user", () => {
  assert.match(milestoneSource, /eq\(referralsTable\.referredUserId, referredUserId\)/);
  assert.match(milestoneSource, /eq\(referralsTable\.id, referral\.id\)/);
  assert.doesNotMatch(milestoneSource, /input\.userId/);
});

test("raw attribution secrets and referred identities stay out of dashboards", () => {
  assert.match(repositorySource, /attributionTokenHash: hash\(token\)/);
  assert.doesNotMatch(repositorySource, /attributionTokenHash:\s*token/);
  assert.doesNotMatch(
    repositorySource.slice(repositorySource.indexOf("export async function getReferralDashboard")),
    /referredUserId:/,
  );
});

test("paid conversion becomes reward eligible and cancellation remains visible", () => {
  assert.match(milestoneSource, /rewardStatus = rewardStatus === "not_eligible" \? "eligible"/);
  assert.match(milestoneSource, /currentStatus = "subscription_started"/);
  assert.match(milestoneSource, /currentStatus = "canceled"/);
});
