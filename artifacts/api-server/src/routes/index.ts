import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import financialDataRouter from "./financial-data.js";
import scanRouter from "./scan.js";
import aiAskRouter from "./ai-ask.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(financialDataRouter);
router.use(scanRouter);
router.use(aiAskRouter);

export default router;
