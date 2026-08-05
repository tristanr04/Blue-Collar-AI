import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import financialDataRouter from "./financial-data.js";
import migrateRouter from "./migrate.js";
import scanRouter from "./scan.js";
import aiAskRouter from "./ai-ask.js";
import backgroundJobsRouter from "./background-jobs.js";
import profileContextRouter from "./profile-context.js";
import taxScenariosRouter from "./tax-scenarios.js";
import taxContextRouter from "./tax-context.js";
import spendingInsightsRouter from "./spending-insights.js";
import transactionImportRouter from "./transaction-import.js";
import transactionStatementImportRouter from "./transaction-statement-import.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(financialDataRouter);
router.use(migrateRouter);
router.use(scanRouter);
router.use(aiAskRouter);
router.use(backgroundJobsRouter);
router.use(profileContextRouter);
router.use(taxScenariosRouter);
router.use(taxContextRouter);
router.use(spendingInsightsRouter);
router.use(transactionImportRouter);
router.use(transactionStatementImportRouter);

export default router;
