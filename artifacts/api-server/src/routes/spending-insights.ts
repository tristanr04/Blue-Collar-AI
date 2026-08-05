import { Router, type IRouter } from "express";
import {
  analyzeSpending,
  type SpendingProfile,
  type SpendingTransaction,
} from "../lib/spending-insights.js";

const router: IRouter = Router();

router.post("/spending/analyze", (req, res) => {
  const transactions = Array.isArray(req.body?.transactions)
    ? req.body.transactions as SpendingTransaction[]
    : [];
  const profile = (req.body?.profile ?? {}) as Partial<SpendingProfile>;

  if (!transactions.length) {
    res.status(400).json({
      error: "At least one transaction is required.",
      missing: ["transactions"],
    });
    return;
  }

  const normalizedProfile: SpendingProfile = {
    monthlyNetIncome: Number(profile.monthlyNetIncome) || 0,
    emergencyFund: Number(profile.emergencyFund) || 0,
    monthlyEssentialExpenses: Number(profile.monthlyEssentialExpenses) || 0,
    highInterestDebtBalance: Number(profile.highInterestDebtBalance) || 0,
    savingsGoalMonthly: Number(profile.savingsGoalMonthly) || 0,
    investingGoalMonthly: Number(profile.investingGoalMonthly) || 0,
  };

  const cleanedTransactions = transactions
    .filter(transaction => transaction && typeof transaction === "object")
    .map((transaction, index) => ({
      id: String(transaction.id ?? `transaction-${index}`),
      date: String(transaction.date ?? new Date().toISOString()),
      merchant: String(transaction.merchant ?? "Unknown merchant"),
      amount: Math.max(0, Number(transaction.amount) || 0),
      category: transaction.category ?? "other",
      isRecurring: Boolean(transaction.isRecurring),
      isEssential: Boolean(transaction.isEssential),
    })) as SpendingTransaction[];

  const analysis = analyzeSpending(cleanedTransactions, normalizedProfile);
  res.json({
    ...analysis,
    languagePolicy: {
      shameFree: true,
      labelsAvoided: ["bad with money", "irresponsible", "behind", "failure"],
      purpose: "Show the clearest next action using the user's actual spending pattern.",
    },
  });
});

export default router;
