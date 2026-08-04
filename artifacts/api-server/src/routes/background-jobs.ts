import { Router, type IRouter } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middlewares/auth.js";
import { requireAuthenticatedUser } from "../middlewares/auth.js";
import {
  getBackgroundJobForUser,
  listQueuedJobsForUser,
} from "../lib/background-job-repository.js";

const router: IRouter = Router();

router.use("/jobs", requireAuthenticatedUser);

function userIdFrom(req: AuthenticatedRequest): string {
  if (!req.authenticatedUserId) throw new Error("Authenticated user ID is missing.");
  return req.authenticatedUserId;
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

router.get("/jobs", async (req: AuthenticatedRequest, res) => {
  const userId = userIdFrom(req);
  const { limit } = listQuerySchema.parse(req.query);
  const jobs = await listQueuedJobsForUser(userId, limit);

  res.json({ jobs });
});

router.get("/jobs/:jobId", async (req: AuthenticatedRequest, res) => {
  const userId = userIdFrom(req);
  const jobId = z.string().uuid().parse(req.params.jobId);
  const job = await getBackgroundJobForUser(userId, jobId);

  if (!job) {
    res.status(404).json({
      stage: "job_not_found",
      error: "Background job was not found or does not belong to this account.",
    });
    return;
  }

  res.json({ job });
});

export default router;
