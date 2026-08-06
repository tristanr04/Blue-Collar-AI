/**
 * Business workspace routes.
 *
 * Authorization is enforced at the repository layer — every operation
 * re-validates membership rather than trusting a cached claim.
 */

import { Router, type IRouter, type Response } from "express";
import { ZodError, z } from "zod";
import type { AuthenticatedRequest } from "../middlewares/auth.js";
import { requireAuthenticatedUser } from "../middlewares/auth.js";
import {
  createWorkspace,
  getWorkspace,
  listUserWorkspaces,
  listMembers,
  createInvitation,
  acceptInvitation,
  removeMember,
  promoteToAdmin,
  transferOwnership,
  revokeInvitation,
  WorkspaceError,
} from "../lib/workspace-repository.js";
import { appendAuditEvent } from "../lib/audit-repository.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
router.use("/workspaces", requireAuthenticatedUser);

const CreateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  maxSeats: z.number().int().min(2).max(500).default(5),
});

const InviteSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(["admin", "member"]).default("member"),
});

const AcceptSchema = z.object({
  token: z.string().min(16).max(200),
});

const PromoteSchema = z.object({
  userId: z.string().min(1).max(200),
});

const TransferSchema = z.object({
  newOwnerId: z.string().min(1).max(200),
});

function uid(req: AuthenticatedRequest): string {
  if (!req.authenticatedUserId) throw new Error("Missing authenticated user ID.");
  return req.authenticatedUserId;
}

function requestId(req: AuthenticatedRequest): string | null {
  return (req as any).requestId ?? req.get("x-request-id") ?? null;
}

function handleError(res: Response, error: unknown) {
  if (error instanceof ZodError) {
    return res.status(400).json({ error: "Invalid input.", details: error.flatten() });
  }
  if (error instanceof WorkspaceError) {
    const status =
      error.code === "not_found" ? 404
      : error.code === "forbidden" ? 403
      : error.code === "seat_limit_exceeded" ? 409
      : error.code === "already_member" ? 409
      : error.code === "invalid_invitation" || error.code === "invitation_expired" || error.code === "invitation_already_used" ? 410
      : 409;
    return res.status(status).json({ error: error.message, code: error.code });
  }
  logger.error({ error }, "workspace_route_error");
  return res.status(500).json({ error: "Could not process workspace request." });
}

// ─── Workspace CRUD ───────────────────────────────────────────────────────────

// GET /api/workspaces — list all workspaces the user belongs to
router.get("/workspaces", async (req: AuthenticatedRequest, res) => {
  try {
    const workspaces = await listUserWorkspaces(uid(req));
    return res.json({ workspaces });
  } catch (error) {
    return handleError(res, error);
  }
});

// POST /api/workspaces — create a workspace (owner is the requesting user)
router.post("/workspaces", async (req: AuthenticatedRequest, res) => {
  try {
    const { name, maxSeats } = CreateWorkspaceSchema.parse(req.body);
    const workspace = await createWorkspace(uid(req), name, maxSeats);
    appendAuditEvent({
      userId: uid(req), action: "create", entityType: "workspace", entityId: workspace.id,
      requestId: requestId(req), source: "api",
    }).catch(() => {});
    return res.status(201).json({ workspace });
  } catch (error) {
    return handleError(res, error);
  }
});

// GET /api/workspaces/:id
router.get("/workspaces/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const workspace = await getWorkspace(uid(req), String(req.params["id"]));
    return res.json({ workspace });
  } catch (error) {
    return handleError(res, error);
  }
});

// ─── Members ──────────────────────────────────────────────────────────────────

// GET /api/workspaces/:id/members
router.get("/workspaces/:id/members", async (req: AuthenticatedRequest, res) => {
  try {
    const members = await listMembers(uid(req), String(req.params["id"]));
    return res.json({ members });
  } catch (error) {
    return handleError(res, error);
  }
});

// DELETE /api/workspaces/:id/members/:userId — remove a member
router.delete("/workspaces/:id/members/:userId", async (req: AuthenticatedRequest, res) => {
  try {
    await removeMember(uid(req), String(req.params["id"]), String(req.params["userId"]));
    appendAuditEvent({
      userId: uid(req), action: "delete", entityType: "workspace_member",
      entityId: String(req.params["userId"]), requestId: requestId(req), source: "api",
      metadata: { workspaceId: String(req.params["id"]) },
    }).catch(() => {});
    return res.json({ removed: true });
  } catch (error) {
    return handleError(res, error);
  }
});

// POST /api/workspaces/:id/members/:userId/promote — promote to admin
router.post("/workspaces/:id/members/:userId/promote", async (req: AuthenticatedRequest, res) => {
  try {
    await promoteToAdmin(uid(req), String(req.params["id"]), String(req.params["userId"]));
    return res.json({ promoted: true });
  } catch (error) {
    return handleError(res, error);
  }
});

// POST /api/workspaces/:id/transfer — transfer ownership to another member
router.post("/workspaces/:id/transfer", async (req: AuthenticatedRequest, res) => {
  try {
    const { newOwnerId } = TransferSchema.parse(req.body);
    await transferOwnership(uid(req), String(req.params["id"]), newOwnerId);
    appendAuditEvent({
      userId: uid(req), action: "update", entityType: "workspace_ownership",
      entityId: String(req.params["id"]), requestId: requestId(req), source: "api",
      metadata: { newOwnerId },
    }).catch(() => {});
    return res.json({ transferred: true });
  } catch (error) {
    return handleError(res, error);
  }
});

// ─── Invitations ──────────────────────────────────────────────────────────────

// POST /api/workspaces/:id/invitations — send an invitation
router.post("/workspaces/:id/invitations", async (req: AuthenticatedRequest, res) => {
  try {
    const { email, role } = InviteSchema.parse(req.body);
    const result = await createInvitation(uid(req), String(req.params["id"]), email, role);
    appendAuditEvent({
      userId: uid(req), action: "create", entityType: "workspace_invitation",
      entityId: result.invitation.id, requestId: requestId(req), source: "api",
      metadata: { workspaceId: String(req.params["id"]), role },
    }).catch(() => {});
    // Return token only once — it cannot be recovered
    return res.status(201).json({
      token: result.token,
      invitation: {
        id: result.invitation.id,
        email: result.invitation.email,
        role: result.invitation.role,
        expiresAt: result.invitation.expiresAt,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
});

// POST /api/workspaces/invitations/accept — accept via token
router.post("/workspaces/invitations/accept", async (req: AuthenticatedRequest, res) => {
  try {
    const { token } = AcceptSchema.parse(req.body);
    const membership = await acceptInvitation(token, uid(req));
    return res.json({ membership });
  } catch (error) {
    return handleError(res, error);
  }
});

// DELETE /api/workspaces/:id/invitations/:invId — revoke pending invitation
router.delete("/workspaces/:id/invitations/:invId", async (req: AuthenticatedRequest, res) => {
  try {
    await revokeInvitation(uid(req), String(req.params["id"]), String(req.params["invId"]));
    return res.json({ revoked: true });
  } catch (error) {
    return handleError(res, error);
  }
});

export default router;
