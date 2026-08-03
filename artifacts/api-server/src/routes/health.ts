import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Required by scanner diagnostics: GET /api/health
router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "financial-scanner-api" });
});

export default router;
