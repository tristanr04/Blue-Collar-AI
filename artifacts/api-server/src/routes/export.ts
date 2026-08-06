/**
 * Personal data export — GET /api/export
 *
 * Returns a structured JSON document containing all non-derived data the
 * authenticated user has provided. This satisfies the Scenario A requirement
 * that a user can export their personal data.
 *
 * Security:
 *   - Requires authenticated session (Clerk).
 *   - Filters every table by userId — no cross-user leakage is possible.
 *   - Excludes internal processing fields (token hashes, etc.).
 *   - Rate-limited to 10 exports per 15 minutes to prevent abuse.
 */

import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { and, eq, isNull } from "drizzle-orm";
import type { AuthenticatedRequest } from "../middlewares/auth.js";
import { requireAuthenticatedUser } from "../middlewares/auth.js";
import {
  db,
  usersTable,
  profilesTable,
  paystubsTable,
  debtsTable,
  billsTable,
  assetsTable,
  financialGoalsTable,
  debtPayoffPlansTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many export requests. Please wait before exporting again." },
});

router.get(
  "/export",
  requireAuthenticatedUser,
  exportLimiter,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.authenticatedUserId;
    if (!userId) return res.status(401).json({ error: "Unauthenticated." });

    try {
      const [user, profile, paystubs, debts, bills, assets, goals, payoffPlans] =
        await Promise.all([
          db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1),
          db.select().from(profilesTable).where(eq(profilesTable.userId, userId)).limit(1),
          db
            .select()
            .from(paystubsTable)
            .where(and(eq(paystubsTable.userId, userId), isNull(paystubsTable.deletedAt))),
          db
            .select()
            .from(debtsTable)
            .where(and(eq(debtsTable.userId, userId), isNull(debtsTable.deletedAt))),
          db
            .select()
            .from(billsTable)
            .where(and(eq(billsTable.userId, userId), isNull(billsTable.deletedAt))),
          db
            .select()
            .from(assetsTable)
            .where(and(eq(assetsTable.userId, userId), isNull(assetsTable.deletedAt))),
          db
            .select()
            .from(financialGoalsTable)
            .where(and(eq(financialGoalsTable.userId, userId), isNull(financialGoalsTable.deletedAt))),
          db
            .select()
            .from(debtPayoffPlansTable)
            .where(and(eq(debtPayoffPlansTable.userId, userId), eq(debtPayoffPlansTable.status, "active"))),
        ]);

      const safeUser = user[0]
        ? {
            id: user[0].id,
            email: user[0].email,
            displayName: user[0].displayName,
            createdAt: user[0].createdAt,
          }
        : null;

      const payload = {
        exportedAt: new Date().toISOString(),
        schemaVersion: "1.0.0",
        user: safeUser,
        profile: profile[0] ?? null,
        paystubs,
        debts,
        bills,
        assets,
        goals,
        payoffPlans,
      };

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="bcfai-export-${new Date().toISOString().slice(0, 10)}.json"`,
      );
      return res.json(payload);
    } catch (error) {
      logger.error({ error, userId }, "export_failed");
      return res.status(500).json({ error: "Export failed. Please try again." });
    }
  },
);

export default router;
