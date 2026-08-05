import { Router, type IRouter, type Response } from "express";
import { z, ZodError } from "zod";
import type { AuthenticatedRequest } from "../middlewares/auth.js";
import { requireAuthenticatedUser } from "../middlewares/auth.js";
import {
  attachReferralToUser,
  getReferralDashboard,
  getOrCreateReferralCode,
  ReferralError,
  startReferralAttribution,
} from "../lib/referral-repository.js";
import {
  recordReferralMilestone,
  referralMilestones,
} from "../lib/referral-milestones.js";
import { appendAuditEvent } from "../lib/audit-repository.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const VisitSchema = z.object({
  code: z.string().trim().min(4).max(32),
  anonymousVisitorId: z.string().trim().min(8).max(200).optional(),
  source: z.string().trim().min(1).max(80).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const AttachSchema = z.object({
  attributionToken: z.string().trim().min(32).max(200),
});

const MilestoneSchema = z.object({
  milestone: z.enum(referralMilestones),
  metadata: z.record(z.unknown()).optional(),
});

function userId(req: AuthenticatedRequest): string {
  if (!req.authenticatedUserId) throw new Error("Authenticated user ID is missing.");
  return req.authenticatedUserId;
}

function requestId(req: AuthenticatedRequest): string | null {
  return (req as AuthenticatedRequest & { requestId?: string }).requestId ?? null;
}

function handleError(res: Response, error: unknown) {
  if (error instanceof ZodError) {
    return res.status(400).json({ error: "Invalid referral request.", details: error.flatten() });
  }
  if (error instanceof ReferralError) {
    const status = error.code === "code_not_found" || error.code === "attribution_not_found"
      ? 404
      : error.code === "attribution_expired"
        ? 410
        : 409;
    return res.status(status).json({ error: error.message, code: error.code });
  }
  logger.error({ error }, "referrals_route_error");
  return res.status(500).json({ error: "Could not process referral request." });
}

// Public endpoint used when a referral link is opened. The raw attribution
// token is returned once and only its SHA-256 hash is stored server-side.
router.post("/referrals/visit", async (req, res) => {
  try {
    const input = VisitSchema.parse(req.body);
    const attribution = await startReferralAttribution(input);
    return res.status(201).json({ attribution });
  } catch (error) {
    return handleError(res, error);
  }
});

router.use("/referrals", requireAuthenticatedUser);

// Creates or returns the signed-in user's stable personal code. Read-only
// retrieval is intentionally not written to the mutation audit log.
router.post("/referrals/code", async (req: AuthenticatedRequest, res) => {
  try {
    const uid = userId(req);
    const code = await getOrCreateReferralCode(uid);
    return res.json({ code: code.code, isActive: code.isActive });
  } catch (error) {
    return handleError(res, error);
  }
});

// Attaches an anonymous referral visit to the newly authenticated account.
router.post("/referrals/attach", async (req: AuthenticatedRequest, res) => {
  try {
    const uid = userId(req);
    const input = AttachSchema.parse(req.body);
    const referral = await attachReferralToUser(input.attributionToken, uid);

    appendAuditEvent({
      userId: uid,
      action: "update",
      entityType: "referral",
      entityId: referral.id,
      requestId: requestId(req),
      source: "api",
    }).catch(() => {});

    return res.json({ attached: true, referralId: referral.id });
  } catch (error) {
    return handleError(res, error);
  }
});

// Product routes can call this after their primary action succeeds. The user
// identity always comes from verified auth, never from request input.
router.post("/referrals/milestones", async (req: AuthenticatedRequest, res) => {
  try {
    const uid = userId(req);
    const input = MilestoneSchema.parse(req.body);
    const result = await recordReferralMilestone(uid, input.milestone, input.metadata);

    if (result.tracked && result.referralId) {
      appendAuditEvent({
        userId: uid,
        action: "update",
        entityType: "referral_milestone",
        entityId: result.referralId,
        requestId: requestId(req),
        source: "api",
        metadata: { milestone: input.milestone },
      }).catch(() => {});
    }

    return res.json(result);
  } catch (error) {
    return handleError(res, error);
  }
});

// Returns aggregate progress plus a privacy-safe timeline. Referred user IDs
// and visitor fingerprints are intentionally never returned.
router.get("/referrals/dashboard", async (req: AuthenticatedRequest, res) => {
  try {
    const dashboard = await getReferralDashboard(userId(req));
    return res.json({ dashboard });
  } catch (error) {
    return handleError(res, error);
  }
});

export default router;
