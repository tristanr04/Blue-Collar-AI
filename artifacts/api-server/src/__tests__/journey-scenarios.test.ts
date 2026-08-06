/**
 * Phase 3 — Realistic User-Journey Backtests
 *
 * Seven end-to-end scenarios exercised at the repository / service layer
 * (same layer the API routes call), giving full coverage of the real
 * business logic without HTTP overhead.
 *
 * Scenario A — Free user: onboard, scan doc (within limit), hit paywall
 * Scenario B — Irregular-income worker: multiple paystubs, tax estimate, scenario planning
 * Scenario C — Debt-heavy user: add debts, run payoff planner, create goal, contribute
 * Scenario D — Paid subscriber: upgrade plan, access gated features, scan beyond free limit
 * Scenario E — Referral flow: create code, share, referred user joins, dashboard stats
 * Scenario F — Business workspace: create, invite, role management, cross-workspace denial
 * Scenario G — Destructive / recovery: soft-delete data, verify gone, re-create
 */

import { describe, test, before } from "node:test";
import assert from "node:assert/strict";

// ── Repository imports ────────────────────────────────────────────────────────
import { ensureUser, createDebt, createPaystub } from "../lib/financial-repository.js";
import {
  getOrInitSubscription,
  upsertSubscription,
  getEffectivePlan,
  recordScanUsage,
  getScanUsageForPeriod,
} from "../lib/subscription-repository.js";
import { checkEntitlement, currentPeriodKey } from "../lib/entitlements.js";
import {
  createGoal,
  getGoalById,
  contributeToGoal,
  archiveGoal,
  listGoals,
  getOrCreateEmergencyFundGoal,
} from "../lib/goals-repository.js";
import { calculatePayoffSchedule } from "../lib/payoff-calculator.js";
import {
  getOrCreateReferralCode,
  startReferralAttribution,
  attachReferralToUser,
  getReferralDashboard,
  ReferralError,
} from "../lib/referral-repository.js";
import {
  createWorkspace,
  getWorkspace,
  listMembers,
  createInvitation,
  acceptInvitation,
  removeMember,
  promoteToAdmin,
  transferOwnership,
  listUserWorkspaces,
  WorkspaceError,
} from "../lib/workspace-repository.js";
import {
  createTaxScenario,
  listTaxScenarios,
  softDeleteTaxScenario,
} from "../lib/tax-scenarios-repository.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Helpers ───────────────────────────────────────────────────────────────────

const stamp = Date.now();
const uid = (s: string) => `journey-${s}-${stamp}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function mkUser(id: string) {
  await db.insert(usersTable).values({ id }).onConflictDoNothing();
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO A — FREE USER
// Covers: sign-up → subscription init → free-tier scan usage → paywall gate
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario A — Free user journey", () => {
  const FREE_USER = uid("free-user");

  before(async () => {
    await mkUser(FREE_USER);
    await ensureUser({ userId: FREE_USER });
  });

  test("A1: subscription initialises on first touch", async () => {
    const sub = await getOrInitSubscription(FREE_USER);
    assert.equal(sub.userId, FREE_USER);
    assert.ok(["free", "trialing"].includes(sub.plan), "New user should be on free or trialing plan");
  });

  test("A2: free plan has 0 scans consumed at start", async () => {
    const period = currentPeriodKey(new Date());
    const used = await getScanUsageForPeriod(FREE_USER, period);
    assert.equal(used, 0, "Fresh account starts with 0 scans used");
  });

  test("A3: recording scan usage increments counter", async () => {
    const period = currentPeriodKey(new Date());
    await recordScanUsage(FREE_USER, period);
    await recordScanUsage(FREE_USER, period);
    const used = await getScanUsageForPeriod(FREE_USER, period);
    assert.equal(used, 2);
  });

  test("A4: free plan entitlement caps at plan limit", () => {
    // Free plan document_scan limit is 10/month
    const result = checkEntitlement({ plan: "free", feature: "document_scan", used: 10, requested: 1 });
    assert.equal(result.allowed, false, "Free user at limit should be denied scan entitlement");
  });

  test("A5: free user below limit can scan", () => {
    const result = checkEntitlement({ plan: "free", feature: "document_scan", used: 2, requested: 1 });
    assert.equal(result.allowed, true, "Free user below limit should have scan entitlement");
  });

  test("A6: free user is limited in AI questions per month", () => {
    // Free plan: 20 AI questions/month limit
    const atLimit = checkEntitlement({ plan: "free", feature: "ai_question", used: 20, requested: 1 });
    assert.equal(atLimit.allowed, false, "Free user at AI limit must be denied");
    assert.equal(atLimit.upgradeRequired, true, "Upgrade should be required");
    const belowLimit = checkEntitlement({ plan: "free", feature: "ai_question", used: 5, requested: 1 });
    assert.equal(belowLimit.allowed, true);
  });

  test("A7: business plan has unlimited AI questions (null limit)", () => {
    // Business plan has null limit = unlimited
    const result = checkEntitlement({ plan: "business", feature: "ai_question", used: 99999, requested: 1 });
    assert.equal(result.allowed, true, "Business plan should be unlimited");
    assert.equal(result.limit, null, "Business plan limit is null = unlimited");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO B — IRREGULAR-INCOME WORKER
// Covers: multiple paystubs (varying amounts/periods), tax scenarios, math
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario B — Irregular-income worker", () => {
  const LINEMAN = uid("lineman");

  before(async () => {
    await mkUser(LINEMAN);
    await ensureUser({ userId: LINEMAN });
  });

  test("B1: creates base paystub from regular week", async () => {
    const stub = await createPaystub(LINEMAN, {
      employerName: "Pike Electric",
      grossPay: 1_800,
      netPay: 1_312,
      payDate: new Date("2026-07-07"),
      regularHours: 40,
      overtimeHours: 0,
    });
    assert.match(stub.id, UUID_RE);
    assert.equal(stub.grossPay, 1_800);
  });

  test("B2: creates overtime paystub from a storm-response week", async () => {
    const stub = await createPaystub(LINEMAN, {
      employerName: "Pike Electric",
      grossPay: 4_200,   // heavy OT
      netPay: 2_940,
      payDate: new Date("2026-07-14"),
      regularHours: 40,
      overtimeHours: 44, // 84 total hours
    });
    assert.equal(stub.grossPay, 4_200);
    assert.ok(stub.overtimeHours && stub.overtimeHours > 0, "Overtime stub should have overtime hours");
  });

  test("B3: creates a third paystub representing a light week", async () => {
    const stub = await createPaystub(LINEMAN, {
      employerName: "Pike Electric",
      grossPay: 900,    // only 20 hours (partial week)
      netPay: 657,
      payDate: new Date("2026-07-21"),
      regularHours: 20,
      overtimeHours: 0,
    });
    assert.equal(stub.regularHours, 20);
  });

  test("B4: saves a tax scenario for irregular income", async () => {
    const scenario = await createTaxScenario(LINEMAN, {
      name: "Storm-season OT estimate",
      taxYear: 2026,
      inputs: { filingStatus: "single", grossAnnualIncome: 95_000, stateCode: "TX", iraContributions: 3_500 },
      result: { estimatedTax: 18_200, effectiveRate: 0.192 },
    });
    assert.ok(scenario.id, "Tax scenario should be saved");
    assert.equal(scenario.name, "Storm-season OT estimate");
  });

  test("B5: saves a second tax scenario for minimum income year", async () => {
    await createTaxScenario(LINEMAN, {
      name: "Slow year estimate",
      taxYear: 2026,
      inputs: { filingStatus: "single", grossAnnualIncome: 55_000, stateCode: "TX", iraContributions: 1_500 },
      result: { estimatedTax: 8_100, effectiveRate: 0.147 },
    });
    const scenarios = await listTaxScenarios(LINEMAN);
    assert.ok(scenarios.length >= 2, "Two distinct scenarios should exist");
    const names = scenarios.map((s) => s.name);
    assert.ok(names.includes("Storm-season OT estimate"));
    assert.ok(names.includes("Slow year estimate"));
  });

  test("B6: can delete a scenario without affecting the other", async () => {
    const allBefore = await listTaxScenarios(LINEMAN);
    const toDelete = allBefore.find((s) => s.name === "Slow year estimate")!;
    assert.ok(toDelete, "Slow year scenario must exist before delete");
    await softDeleteTaxScenario(LINEMAN, toDelete.id);
    const allAfter = await listTaxScenarios(LINEMAN);
    const ids = allAfter.map((s) => s.id);
    assert.ok(!ids.includes(toDelete.id), "Deleted scenario must not appear in list");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO C — DEBT-HEAVY USER
// Covers: debts, payoff planner (avalanche vs snowball), goal creation, contributions
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario C — Debt-heavy user", () => {
  const DEBTOR = uid("debtor");
  let creditCardId: string;
  let autoLoanId: string;
  let medicalBillId: string;

  before(async () => {
    await mkUser(DEBTOR);
    await ensureUser({ userId: DEBTOR });
  });

  test("C1: user adds three debts", async () => {
    const cc = await createDebt(DEBTOR, {
      name: "Capital One Card",
      balance: 8_400,
      interestRate: 24.99,
      minimumPayment: 168,
    });
    const auto = await createDebt(DEBTOR, {
      name: "Auto Loan",
      balance: 14_200,
      interestRate: 7.9,
      minimumPayment: 285,
    });
    const med = await createDebt(DEBTOR, {
      name: "Medical Bill",
      balance: 2_100,
      interestRate: 0,
      minimumPayment: 75,
    });
    creditCardId = cc.id;
    autoLoanId = auto.id;
    medicalBillId = med.id;
    assert.match(cc.id, UUID_RE);
    assert.match(auto.id, UUID_RE);
    assert.match(med.id, UUID_RE);
  });

  test("C2: avalanche calculator targets credit card first", () => {
    const debts = [
      { id: creditCardId, name: "Capital One Card", balance: 8_400, interestRate: 24.99, minimumPayment: 168 },
      { id: autoLoanId, name: "Auto Loan", balance: 14_200, interestRate: 7.9, minimumPayment: 285 },
      { id: medicalBillId, name: "Medical Bill", balance: 2_100, interestRate: 0, minimumPayment: 75 },
    ];
    const sched = calculatePayoffSchedule({ debts, strategy: "avalanche", extraMonthlyPayment: 300 });
    // Credit card (24.99% APR) should be paid off before auto loan (7.9%)
    const ccSummary = sched.debtSummaries.find((s) => s.debtId === creditCardId)!;
    const autoSummary = sched.debtSummaries.find((s) => s.debtId === autoLoanId)!;
    assert.ok(ccSummary.payoffMonth <= autoSummary.payoffMonth,
      "Avalanche must pay off credit card (highest APR) before auto loan");
  });

  test("C3: snowball targets medical bill (lowest balance) first", () => {
    const debts = [
      { id: creditCardId, name: "Capital One Card", balance: 8_400, interestRate: 24.99, minimumPayment: 168 },
      { id: autoLoanId, name: "Auto Loan", balance: 14_200, interestRate: 7.9, minimumPayment: 285 },
      { id: medicalBillId, name: "Medical Bill", balance: 2_100, interestRate: 0, minimumPayment: 75 },
    ];
    const sched = calculatePayoffSchedule({ debts, strategy: "snowball", extraMonthlyPayment: 300 });
    const medSummary = sched.debtSummaries.find((s) => s.debtId === medicalBillId)!;
    const ccSummary = sched.debtSummaries.find((s) => s.debtId === creditCardId)!;
    assert.ok(medSummary.payoffMonth <= ccSummary.payoffMonth,
      "Snowball must pay off medical bill (lowest balance) before credit card");
  });

  test("C4: 0% promo medical bill accrues zero interest", () => {
    const debts = [
      { id: medicalBillId, name: "Medical Bill", balance: 2_100, interestRate: 0, minimumPayment: 75 },
    ];
    const sched = calculatePayoffSchedule({ debts, strategy: "avalanche", extraMonthlyPayment: 0 });
    assert.equal(sched.totalInterestPaid, 0);
  });

  test("C5: user creates a debt payoff goal", async () => {
    const goal = await createGoal(DEBTOR, {
      title: "Kill the credit card",
      category: "debt_payoff",
      targetAmount: 8_400,
      notes: "Avalanche method, $300 extra",
    });
    assert.match(goal.id, UUID_RE);
    assert.equal(goal.category, "debt_payoff");
    assert.equal(goal.currentAmount, 0);
  });

  test("C6: bi-monthly contributions track progress toward goal", async () => {
    const goal = await createGoal(DEBTOR, {
      title: "Emergency fund starter",
      category: "emergency_fund",
      targetAmount: 1_000,
    });
    const after1 = await contributeToGoal(DEBTOR, goal.id, 250);
    assert.equal(after1?.currentAmount, 250);
    const after2 = await contributeToGoal(DEBTOR, goal.id, 300);
    assert.equal(after2?.currentAmount, 550);
    assert.equal(after2?.status, "active", "Still active below target");
  });

  test("C7: final contribution completes the goal", async () => {
    const goal = await createGoal(DEBTOR, {
      title: "Small goal",
      category: "savings",
      targetAmount: 500,
    });
    await contributeToGoal(DEBTOR, goal.id, 200);
    const completed = await contributeToGoal(DEBTOR, goal.id, 400); // goes over
    assert.equal(completed?.currentAmount, 500, "Should clamp at target");
    assert.equal(completed?.status, "completed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO D — PAID SUBSCRIBER
// Covers: plan upgrade, gated entitlements unlock, higher scan limit
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario D — Paid subscriber", () => {
  const PRO_USER = uid("pro-user");

  before(async () => {
    await mkUser(PRO_USER);
    await ensureUser({ userId: PRO_USER });
  });

  test("D1: user subscribes to pro plan", async () => {
    await upsertSubscription(PRO_USER, {
      stripeCustomerId: `cus_journey_${stamp}`,
      stripeSubscriptionId: `sub_journey_${stamp}`,
      plan: "pro",
      status: "active",
    });
    const { plan } = await getEffectivePlan(PRO_USER);
    assert.equal(plan, "pro");
  });

  test("D2: pro user has generous AI question limit", () => {
    // Pro: 300 AI questions/month
    const result = checkEntitlement({ plan: "pro", feature: "ai_question", used: 299, requested: 1 });
    assert.equal(result.allowed, true);
    assert.equal(result.limit, 300);
  });

  test("D3: business plan has unlimited document scanning", () => {
    // Business plan: null limit = unlimited scans
    const result = checkEntitlement({ plan: "business", feature: "document_scan", used: 9999, requested: 1 });
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, null, "Null remaining means unlimited");
  });

  test("D4: pro user can scan beyond free tier cap (free limit = 10)", () => {
    // Pro plan: 150 scans/month
    const result = checkEntitlement({ plan: "pro", feature: "document_scan", used: 50, requested: 1 });
    assert.equal(result.allowed, true, "Pro user at 50/150 should have scan entitlement");
    const atLimit = checkEntitlement({ plan: "free", feature: "document_scan", used: 10, requested: 1 });
    assert.equal(atLimit.allowed, false, "Free user at 10/10 should be blocked");
  });

  test("D5: recording 10 scans in period accumulates correctly", async () => {
    const period = currentPeriodKey(new Date());
    for (let i = 0; i < 10; i++) {
      await recordScanUsage(PRO_USER, period);
    }
    const used = await getScanUsageForPeriod(PRO_USER, period);
    assert.ok(used >= 10, `Expected >= 10 scans, got ${used}`);
  });

  test("D6: subscription downgrade removes premium features", async () => {
    await upsertSubscription(PRO_USER, {
      stripeCustomerId: `cus_journey_${stamp}`,
      stripeSubscriptionId: `sub_journey_${stamp}`,
      plan: "free",
      status: "active",
    });
    const { plan } = await getEffectivePlan(PRO_USER);
    assert.equal(plan, "free");
    const result = checkEntitlement({ plan: "free", feature: "ai_question", used: 20, requested: 1 });
    assert.equal(result.allowed, false, "Downgraded free user at limit must be denied");
    assert.equal(result.upgradeRequired, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO E — REFERRAL FLOW
// Covers: code creation, attribution start, attach to referred user, dashboard
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario E — Referral flow", () => {
  const REFERRER = uid("ref-e-referrer");
  const REFERRED_1 = uid("ref-e-referred1");
  const REFERRED_2 = uid("ref-e-referred2");

  before(async () => {
    await Promise.all([
      mkUser(REFERRER),
      mkUser(REFERRED_1),
      mkUser(REFERRED_2),
    ]);
  });

  test("E1: referrer gets a stable code on multiple calls", async () => {
    const first = await getOrCreateReferralCode(REFERRER);
    const second = await getOrCreateReferralCode(REFERRER);
    assert.equal(first.code, second.code, "Code must be idempotent");
    assert.ok(first.code.length >= 4, "Code should be non-trivial");
  });

  test("E2: referred user follows the link — token created", async () => {
    const code = await getOrCreateReferralCode(REFERRER);
    const { token } = await startReferralAttribution({ code: code.code });
    assert.ok(token, "Token must be returned");
    assert.ok(token.length > 8, "Token should be a substantial string");
  });

  test("E3: referred user signs up and attaches referral", async () => {
    const code = await getOrCreateReferralCode(REFERRER);
    const { token } = await startReferralAttribution({ code: code.code });
    // Should not throw
    await attachReferralToUser(token, REFERRED_1);
  });

  test("E4: second referral from same referrer succeeds", async () => {
    const code = await getOrCreateReferralCode(REFERRER);
    const { token } = await startReferralAttribution({ code: code.code });
    await attachReferralToUser(token, REFERRED_2);
  });

  test("E5: dashboard shows positive signup count", async () => {
    const dash = await getReferralDashboard(REFERRER);
    assert.ok(dash.counts.signups >= 2,
      `Expected >= 2 signups in dashboard, got ${dash.counts.signups}`);
  });

  test("E6: circular referral A→B then B→A is blocked", async () => {
    const userA = uid("e-circ-a");
    const userB = uid("e-circ-b");
    await mkUser(userA);
    await mkUser(userB);

    const codeA = await getOrCreateReferralCode(userA);
    const { token: t1 } = await startReferralAttribution({ code: codeA.code });
    await attachReferralToUser(t1, userB);

    const codeB = await getOrCreateReferralCode(userB);
    const { token: t2 } = await startReferralAttribution({ code: codeB.code });
    try {
      await attachReferralToUser(t2, userA);
      assert.fail("Circular referral must be rejected");
    } catch (e) {
      assert.ok(e instanceof ReferralError);
      assert.equal((e as ReferralError).code, "circular_referral");
    }
  });

  test("E7: self-referral is blocked", async () => {
    const code = await getOrCreateReferralCode(REFERRER);
    const { token } = await startReferralAttribution({ code: code.code });
    try {
      await attachReferralToUser(token, REFERRER);
      assert.fail("Self-referral must be rejected");
    } catch (e) {
      assert.ok(e instanceof ReferralError);
      assert.equal((e as ReferralError).code, "self_referral");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO F — BUSINESS WORKSPACE
// Covers: create, invite, accept, role promotion, ownership transfer, seat limits,
//         cross-workspace access denial, only-owner removal guard
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario F — Business workspace", () => {
  const BOSS = uid("ws-boss");
  const EMP_A = uid("ws-emp-a");
  const EMP_B = uid("ws-emp-b");
  const EMP_C = uid("ws-emp-c");
  const STRANGER = uid("ws-stranger");
  let wsId: string;

  before(async () => {
    await Promise.all([
      mkUser(BOSS),
      mkUser(EMP_A),
      mkUser(EMP_B),
      mkUser(EMP_C),
      mkUser(STRANGER),
    ]);
  });

  test("F1: boss creates workspace and is auto-assigned owner role", async () => {
    const ws = await createWorkspace(BOSS, "Pike Crew WS", 5);
    wsId = ws.id;
    const members = await listMembers(BOSS, wsId);
    const boss = members.find((m) => m.userId === BOSS)!;
    assert.equal(boss.role, "owner");
    assert.equal(boss.status, "active");
  });

  test("F2: boss invites Employee A", async () => {
    const { token } = await createInvitation(BOSS, wsId, "emp_a@pike.example");
    await acceptInvitation(token, EMP_A);
    const members = await listMembers(BOSS, wsId);
    const empA = members.find((m) => m.userId === EMP_A);
    assert.ok(empA, "Employee A should be a member");
    assert.equal(empA?.role, "member");
  });

  test("F3: boss invites Employee B", async () => {
    const { token } = await createInvitation(BOSS, wsId, "emp_b@pike.example");
    await acceptInvitation(token, EMP_B);
    const members = await listMembers(BOSS, wsId);
    assert.ok(members.find((m) => m.userId === EMP_B), "Employee B should be a member");
  });

  test("F4: boss promotes Employee A to admin", async () => {
    await promoteToAdmin(BOSS, wsId, EMP_A);
    const members = await listMembers(BOSS, wsId);
    const empA = members.find((m) => m.userId === EMP_A)!;
    assert.equal(empA.role, "admin");
  });

  test("F5: seat limit blocks 5th member when maxSeats=4", async () => {
    const boss2 = uid("ws-boss2");
    const u1 = uid("ws-4u1");
    const u2 = uid("ws-4u2");
    const u3 = uid("ws-4u3");
    const u4 = uid("ws-4u4");
    await Promise.all([mkUser(boss2), mkUser(u1), mkUser(u2), mkUser(u3), mkUser(u4)]);

    const ws2 = await createWorkspace(boss2, "Tiny Crew", 4);
    for (const [uid_, email] of [[u1, "u1@e.com"], [u2, "u2@e.com"], [u3, "u3@e.com"]] as [string, string][]) {
      const { token } = await createInvitation(boss2, ws2.id, email);
      await acceptInvitation(token, uid_);
    }
    // Now at 4 members (boss + 3) — one more invite should fail
    try {
      await createInvitation(boss2, ws2.id, "u4@e.com");
      assert.fail("Should have thrown seat_limit_exceeded");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError);
      assert.equal((e as WorkspaceError).code, "seat_limit_exceeded");
    }
  });

  test("F6: stranger cannot list members of the workspace", async () => {
    try {
      await listMembers(STRANGER, wsId);
      assert.fail("Stranger must not list members");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError);
      assert.equal((e as WorkspaceError).code, "forbidden");
    }
  });

  test("F7: Employee B (member) cannot promote Employee A", async () => {
    try {
      await promoteToAdmin(EMP_B, wsId, EMP_A);
      assert.fail("Regular member must not promote others");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError);
    }
  });

  test("F8: invitation token cannot be re-used", async () => {
    const { token } = await createInvitation(BOSS, wsId, "emp_c@pike.example");
    await acceptInvitation(token, EMP_C);
    // Try re-using the same token
    try {
      await acceptInvitation(token, STRANGER);
      assert.fail("Used token should not be accepted again");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError);
      assert.equal((e as WorkspaceError).code, "invalid_invitation");
    }
  });

  test("F9: only owner cannot be removed", async () => {
    // Boss is the only owner — removing them must fail
    try {
      await removeMember(BOSS, wsId, BOSS);
      assert.fail("Should have thrown cannot_remove_only_owner");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError);
      assert.equal((e as WorkspaceError).code, "cannot_remove_only_owner");
    }
  });

  test("F10: ownership transfers from boss to Employee A", async () => {
    await transferOwnership(BOSS, wsId, EMP_A);
    const members = await listMembers(EMP_A, wsId);
    const newOwner = members.find((m) => m.userId === EMP_A)!;
    const exOwner = members.find((m) => m.userId === BOSS)!;
    assert.equal(newOwner.role, "owner");
    assert.equal(exOwner.role, "admin", "Previous owner should be demoted to admin");
  });

  test("F11: cross-workspace access denied", async () => {
    const otherBoss = uid("other-boss");
    await mkUser(otherBoss);
    const ws2 = await createWorkspace(otherBoss, "Other WS", 5);
    // BOSS (now admin of wsId) should not be able to list members of ws2
    try {
      await listMembers(BOSS, ws2.id);
      assert.fail("Cross-workspace access must be denied");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError);
      assert.equal((e as WorkspaceError).code, "forbidden");
    }
  });

  test("F12: removed member loses workspace access", async () => {
    // EMP_A is now owner, removes EMP_B
    await removeMember(EMP_A, wsId, EMP_B);
    try {
      await getWorkspace(EMP_B, wsId);
      assert.fail("Removed member should not access workspace");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError);
      assert.equal((e as WorkspaceError).code, "forbidden");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO G — DESTRUCTIVE / RECOVERY
// Covers: soft-delete goals, verify deletion, re-create, emergency-fund idempotency,
//         cross-user data isolation after deletion
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario G — Destructive / recovery", () => {
  const USER_G = uid("user-g");
  const USER_G2 = uid("user-g2");

  before(async () => {
    await Promise.all([mkUser(USER_G), mkUser(USER_G2)]);
  });

  test("G1: creates three goals", async () => {
    await createGoal(USER_G, { title: "Save for vacation", category: "savings", targetAmount: 3_000 });
    await createGoal(USER_G, { title: "Build E-fund", category: "emergency_fund", targetAmount: 5_000 });
    await createGoal(USER_G, { title: "Car down payment", category: "purchase", targetAmount: 8_000 });
    const goals = await listGoals(USER_G);
    assert.ok(goals.length >= 3, "All three goals must be listed");
  });

  test("G2: archives one goal and it disappears from list", async () => {
    const before = await listGoals(USER_G);
    const victim = before.find((g) => g.title === "Save for vacation")!;
    assert.ok(victim, "Vacation goal must exist");
    await archiveGoal(USER_G, victim.id);
    const after = await listGoals(USER_G);
    const ids = after.map((g) => g.id);
    assert.ok(!ids.includes(victim.id), "Archived goal must not appear in list");
  });

  test("G3: archived goal is not accessible by ID", async () => {
    const goals = await listGoals(USER_G);
    // all returned goals are active
    // create and immediately archive
    const g = await createGoal(USER_G, { title: "Ephemeral", category: "savings", targetAmount: 1 });
    await archiveGoal(USER_G, g.id);
    const fetched = await getGoalById(USER_G, g.id);
    assert.equal(fetched, null, "Archived goal must not be fetchable by ID");
  });

  test("G4: re-creating a goal with the same title after archiving works", async () => {
    // "Save for vacation" was archived in G2 — re-creating should succeed
    const newGoal = await createGoal(USER_G, { title: "Save for vacation", category: "savings", targetAmount: 3_500 });
    assert.match(newGoal.id, UUID_RE, "New goal should have fresh UUID");
    assert.equal(newGoal.targetAmount, 3_500);
  });

  test("G5: emergency fund is idempotent — repeated calls return same goal", async () => {
    const ef1 = await getOrCreateEmergencyFundGoal(USER_G, 5_000);
    const ef2 = await getOrCreateEmergencyFundGoal(USER_G, 7_000);
    assert.equal(ef1.id, ef2.id, "getOrCreateEmergencyFundGoal must be idempotent");
  });

  test("G6: archiving emergency fund and re-creating yields new ID", async () => {
    const ef = await getOrCreateEmergencyFundGoal(USER_G, 5_000);
    await archiveGoal(USER_G, ef.id);
    const newEf = await getOrCreateEmergencyFundGoal(USER_G, 5_000);
    assert.notEqual(ef.id, newEf.id, "After archival, getOrCreate should produce a fresh goal");
  });

  test("G7: deleted user's data is not visible to another user", async () => {
    const g = await createGoal(USER_G, { title: "Private goal G", category: "savings", targetAmount: 100 });
    const fetched = await getGoalById(USER_G2, g.id);
    assert.equal(fetched, null, "User G2 must not access User G's goals");
  });

  test("G8: archiving the only workspace workspace membership guard still works after recovery", async () => {
    // Create a fresh workspace with boss + member, then boss leaves after transfer
    const boss = uid("g-boss");
    const heir = uid("g-heir");
    await mkUser(boss);
    await mkUser(heir);
    const ws = await createWorkspace(boss, "Recovery WS", 5);
    const { token } = await createInvitation(boss, ws.id, "heir@ex.com");
    await acceptInvitation(token, heir);
    await transferOwnership(boss, ws.id, heir);

    // Boss (now admin) removes themselves
    await removeMember(heir, ws.id, boss); // heir as owner can remove boss/admin

    // Boss should now have no access
    try {
      await getWorkspace(boss, ws.id);
      assert.fail("Removed boss must not access workspace");
    } catch (e) {
      assert.ok(e instanceof WorkspaceError);
      assert.equal((e as WorkspaceError).code, "forbidden");
    }

    // Heir can still see the workspace
    const wsCheck = await getWorkspace(heir, ws.id);
    assert.equal(wsCheck.id, ws.id, "New owner retains access");
  });
});
