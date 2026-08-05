import { Router, type IRouter } from "express";
import multer from "multer";
import { findRecurringTransactions, importCsvTransactions, type MerchantRule } from "../lib/transaction-import.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post("/transactions/import/csv", upload.single("file"), async (req, res) => {
  if (!req.file?.buffer?.length) {
    res.status(400).json({ error: "A CSV transaction file is required." });
    return;
  }
  const extension = req.file.originalname.split(".").pop()?.toLowerCase();
  if (extension !== "csv") {
    res.status(422).json({ error: "Upload a CSV export from the bank or card account." });
    return;
  }
  try {
    const merchantRules = req.body.merchantRules ? JSON.parse(req.body.merchantRules) as MerchantRule[] : [];
    const existingFingerprints = req.body.existingFingerprints ? JSON.parse(req.body.existingFingerprints) as string[] : [];
    const imported = importCsvTransactions({
      csv: req.file.buffer.toString("utf8"),
      sourceFile: req.file.originalname,
      accountLastFour: typeof req.body.accountLastFour === "string" ? req.body.accountLastFour.slice(-4) : null,
      merchantRules: Array.isArray(merchantRules) ? merchantRules : [],
      existingFingerprints: Array.isArray(existingFingerprints) ? existingFingerprints : [],
    });
    const recurringMerchants = findRecurringTransactions(imported.transactions);
    const transactions = imported.transactions.map(transaction => ({
      ...transaction,
      recurring: transaction.recurring || recurringMerchants.includes(transaction.merchant),
    }));
    logger.info({
      file: req.file.originalname,
      imported: transactions.length,
      duplicatesSkipped: imported.duplicatesSkipped,
      rejectedRows: imported.rejectedRows,
      needsReview: transactions.filter(transaction => transaction.needsReview).length,
    }, "transaction CSV imported");
    res.json({
      importMode: "csv",
      accountLastFour: typeof req.body.accountLastFour === "string" ? req.body.accountLastFour.slice(-4) : null,
      transactions,
      summary: {
        imported: transactions.length,
        duplicatesSkipped: imported.duplicatesSkipped,
        rejectedRows: imported.rejectedRows,
        excludedFromSpending: transactions.filter(transaction => transaction.excludedFromSpending).length,
        needsReview: transactions.filter(transaction => transaction.needsReview).length,
        recurringDetected: transactions.filter(transaction => transaction.recurring).length,
      },
      warnings: imported.warnings,
      nextStep: transactions.some(transaction => transaction.needsReview)
        ? "Review uncertain merchants and categories before saving."
        : "Transactions are ready to save and analyze.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transaction import failed.";
    logger.warn({ error, file: req.file.originalname }, "transaction CSV rejected");
    res.status(422).json({ error: message });
  }
});

router.post("/transactions/review", (req, res) => {
  const transactions = Array.isArray(req.body?.transactions) ? req.body.transactions as Array<Record<string, unknown>> : [];
  const corrections = Array.isArray(req.body?.corrections) ? req.body.corrections as Array<Record<string, unknown>> : [];
  if (!transactions.length) {
    res.status(400).json({ error: "Transactions are required." });
    return;
  }
  const correctionMap = new Map<string, Record<string, unknown>>();
  for (const item of corrections) {
    if (typeof item.id === "string") correctionMap.set(item.id, item);
  }
  const reviewed = transactions.map(transaction => {
    const id = typeof transaction.id === "string" ? transaction.id : "";
    const correction = correctionMap.get(id);
    return correction ? { ...transaction, ...correction, needsReview: false } : transaction;
  });
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const merchantRules = reviewed
    .filter(transaction => typeof transaction.merchant === "string" && typeof transaction.category === "string" && !transaction.needsReview)
    .map(transaction => ({
      merchantPattern: `^${escapeRegExp(String(transaction.merchant))}$`,
      category: transaction.category,
      excludeFromSpending: Boolean(transaction.excludedFromSpending),
    }));
  res.json({ transactions: reviewed, merchantRules });
});

export default router;
