import { Router, type IRouter, type Response } from "express";
import type { AuthenticatedRequest } from "../middlewares/auth.js";
import { requireAuthenticatedUser } from "../middlewares/auth.js";
import { appendAuditEvent } from "../lib/audit-repository.js";
import {
  getProfileContextForUser,
  upsertProfileContextForUser,
} from "../lib/profile-context-repository.js";

const router: IRouter = Router();

router.use("/profile-context", requireAuthenticatedUser);

function userIdFrom(req: AuthenticatedRequest): string {
  if (!req.authenticatedUserId) throw new Error("Authenticated user ID is missing.");
  return req.authenticatedUserId;
}

function preventSensitiveCaching(res: Response) {
  res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

router.get("/profile-context", async (req: AuthenticatedRequest, res) => {
  preventSensitiveCaching(res);
  const context = await getProfileContextForUser(userIdFrom(req));
  res.json({ context });
});

router.put("/profile-context", async (req: AuthenticatedRequest, res) => {
  preventSensitiveCaching(res);
  const userId = userIdFrom(req);
  const existing = await getProfileContextForUser(userId);
  const context = await upsertProfileContextForUser(userId, req.body);

  appendAuditEvent({
    userId,
    action: existing ? "update" : "create",
    entityType: "profile_context",
    entityId: context.id,
    requestId: (req as AuthenticatedRequest & { requestId?: string }).requestId ?? null,
    source: "api",
    metadata: {
      changedFields: Object.keys(req.body ?? {}).sort(),
    },
  }).catch((error) => {
    console.error("profile_context_audit_failed", {
      userId,
      contextId: context.id,
      error: error instanceof Error ? error.message : "Unknown audit error",
    });
  });

  res.status(existing ? 200 : 201).json({ context });
});

export default router;
