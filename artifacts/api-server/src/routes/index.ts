import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import scanRouter from "./scan.js";
import aiAskRouter from "./ai-ask.js";
import commandCenterRouter from "./command-center.js";
import financialMemoryRouter from "./financial-memory.js";
import retentionNotificationsRouter from "./retention-notifications.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scanRouter);
router.use(aiAskRouter);
router.use(commandCenterRouter);
router.use(financialMemoryRouter);
router.use(retentionNotificationsRouter);

export default router;
