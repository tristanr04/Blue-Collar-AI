import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import scanRouter from "./scan.js";
import aiAskRouter from "./ai-ask.js";
import spendingInsightsRouter from "./spending-insights.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scanRouter);
router.use(aiAskRouter);
router.use(spendingInsightsRouter);

export default router;
