import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";

export interface AuthenticatedRequest extends Request {
  authenticatedUserId?: string;
}

/** Require a verified Clerk session and expose the server-derived user id. */
export function requireAuthenticatedUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const auth = getAuth(req);

  if (!auth.isAuthenticated || !auth.userId) {
    logger.warn(
      { path: req.path, method: req.method, event: "authentication_required" },
      "Unauthenticated request blocked",
    );
    res.status(401).json({
      stage: "authentication",
      error: "You must sign in to use this feature.",
    });
    return;
  }

  req.authenticatedUserId = auth.userId;
  next();
}

/**
 * Restrict developer-only routes. Configure CLERK_ADMIN_USER_IDS as a
 * comma-separated list of Clerk user ids. Production fails closed.
 */
export function requireAdminUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const userId = req.authenticatedUserId;
  if (!userId) {
    res.status(401).json({ stage: "authentication", error: "Authentication required." });
    return;
  }

  const admins = new Set(
    (process.env.CLERK_ADMIN_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  if (!admins.has(userId)) {
    logger.warn(
      { userId, path: req.path, event: "authorization_denied" },
      "Non-admin request blocked",
    );
    res.status(403).json({
      stage: "authorization",
      error: "You do not have permission to access this feature.",
    });
    return;
  }

  next();
}
