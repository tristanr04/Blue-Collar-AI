import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import scanRouter from "./scan.js";
import aiAskRouter from "./ai-ask.js";
import overtimeTaxRouter from "./overtime-tax.js";
import subscriptionsRouter from "./subscriptions.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scanRouter);
router.use(aiAskRouter);
router.use(overtimeTaxRouter);
router.use(subscriptionsRouter);

export default router;
