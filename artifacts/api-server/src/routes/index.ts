import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import scanRouter from "./scan.js";
import aiAskRouter from "./ai-ask.js";
import insuranceScanRouter from "./insurance-scan.js";
import financialGuideRouter from "./financial-guide.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scanRouter);
router.use(aiAskRouter);
router.use(insuranceScanRouter);
router.use(financialGuideRouter);

export default router;
