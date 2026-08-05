export type CommandCenterInput = {
  monthlyNetIncome?: number | null;
  monthlyBills?: number | null;
  monthlyDebtPayments?: number | null;
  cash?: number | null;
  investments?: number | null;
  retirement?: number | null;
  otherAssets?: number | null;
  totalDebt?: number | null;
  highInterestDebt?: number | null;
  creditUtilization?: number | null;
  employerMatchCaptured?: boolean | null;
  latestTaxEstimate?: {
    totalEstimatedTax?: number | null;
    refundOrAmountOwed?: number | null;
    effectiveTaxRate?: number | null;
    confidence?: "low" | "medium" | "high" | null;
  } | null;
};

export type CommandCenterMetric = {
  value: number | null;
  status: "ready" | "missing";
};

export type NextBestMove = {
  category: "income" | "cash-flow" | "emergency-fund" | "debt" | "credit" | "retirement" | "tax" | "complete-profile";
  title: string;
  detail: string;
  estimatedImpact: number | null;
  route: string;
};

export type CommandCenterSummary = {
  netWorth: CommandCenterMetric;
  cash: CommandCenterMetric;
  investments: CommandCenterMetric;
  debt: CommandCenterMetric;
  monthlyCashFlow: CommandCenterMetric;
  emergencyFundMonths: CommandCenterMetric;
  healthScore: number | null;
  taxEstimate: CommandCenterInput["latestTaxEstimate"];
  nextBestMove: NextBestMove;
  missingData: string[];
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
}

function metric(value: number | null): CommandCenterMetric {
  return { value, status: value === null ? "missing" : "ready" };
}

function chooseNextBestMove(input: {
  monthlyNetIncome: number | null;
  monthlyCashFlow: number | null;
  cash: number | null;
  monthlyNeeds: number | null;
  highInterestDebt: number | null;
  creditUtilization: number | null;
  employerMatchCaptured: boolean | null;
  taxEstimate: CommandCenterInput["latestTaxEstimate"];
  missingData: string[];
}): NextBestMove {
  if (input.monthlyNetIncome === null) {
    return {
      category: "income",
      title: "Add your latest paystub",
      detail: "Your income is the starting point for cash-flow, tax, and savings guidance.",
      estimatedImpact: null,
      route: "/scanner",
    };
  }

  if (input.monthlyCashFlow !== null && input.monthlyCashFlow < 0) {
    return {
      category: "cash-flow",
      title: "Close the monthly cash-flow gap",
      detail: `Your confirmed bills and debt payments are about $${Math.abs(Math.round(input.monthlyCashFlow)).toLocaleString()} above monthly take-home.`,
      estimatedImpact: Math.abs(input.monthlyCashFlow),
      route: "/bills",
    };
  }

  const emergencyMonths = input.cash !== null && input.monthlyNeeds !== null && input.monthlyNeeds > 0
    ? input.cash / input.monthlyNeeds
    : null;
  if (emergencyMonths !== null && emergencyMonths < 1) {
    const oneMonthTarget = Math.max(0, input.monthlyNeeds! - input.cash!);
    return {
      category: "emergency-fund",
      title: "Build one month of emergency cash",
      detail: "A one-month buffer is the strongest first layer of protection against missed work or surprise expenses.",
      estimatedImpact: oneMonthTarget,
      route: "/banking",
    };
  }

  if ((input.highInterestDebt ?? 0) > 0) {
    return {
      category: "debt",
      title: "Attack high-interest debt next",
      detail: "Direct extra cash toward the highest APR balance before accelerating lower-rate debt.",
      estimatedImpact: input.highInterestDebt,
      route: "/debts",
    };
  }

  if ((input.creditUtilization ?? 0) > 30) {
    return {
      category: "credit",
      title: "Lower credit utilization below 30%",
      detail: `Your latest confirmed utilization is ${Math.round(input.creditUtilization!)}%. Paying before the statement closes can improve the reported balance.`,
      estimatedImpact: null,
      route: "/debts",
    };
  }

  if (input.employerMatchCaptured === false) {
    return {
      category: "retirement",
      title: "Capture the full employer match",
      detail: "Increase contributions enough to receive every available employer matching dollar.",
      estimatedImpact: null,
      route: "/investments",
    };
  }

  if (!input.taxEstimate) {
    return {
      category: "tax",
      title: "Run and save your tax estimate",
      detail: "A saved estimate lets the dashboard show whether withholding is on pace before year-end.",
      estimatedImpact: null,
      route: "/tax-estimator",
    };
  }

  if (input.missingData.length > 0) {
    return {
      category: "complete-profile",
      title: "Finish your financial picture",
      detail: `Add ${input.missingData[0]} so the dashboard can give a more accurate next move.`,
      estimatedImpact: null,
      route: "/scanner",
    };
  }

  return {
    category: "cash-flow",
    title: "Put this month’s surplus to work",
    detail: "Your core data is complete and cash flow is positive. Direct the surplus to your highest-priority goal.",
    estimatedImpact: input.monthlyCashFlow,
    route: "/scenario",
  };
}

export function createCommandCenterSummary(raw: CommandCenterInput): CommandCenterSummary {
  const monthlyNetIncome = finite(raw.monthlyNetIncome);
  const monthlyBills = finite(raw.monthlyBills);
  const monthlyDebtPayments = finite(raw.monthlyDebtPayments);
  const cash = finite(raw.cash);
  const investments = finite(raw.investments);
  const retirement = finite(raw.retirement);
  const otherAssets = finite(raw.otherAssets);
  const totalDebt = finite(raw.totalDebt);
  const highInterestDebt = finite(raw.highInterestDebt);
  const creditUtilization = finite(raw.creditUtilization);

  const monthlyNeeds = sumKnown([monthlyBills, monthlyDebtPayments]);
  const monthlyCashFlow = monthlyNetIncome !== null && monthlyNeeds !== null
    ? monthlyNetIncome - monthlyNeeds
    : null;
  const assetTotal = sumKnown([cash, investments, retirement, otherAssets]);
  const netWorth = assetTotal !== null && totalDebt !== null ? assetTotal - totalDebt : null;
  const emergencyFundMonths = cash !== null && monthlyNeeds !== null && monthlyNeeds > 0
    ? cash / monthlyNeeds
    : null;

  const missingData: string[] = [];
  if (monthlyNetIncome === null) missingData.push("income");
  if (monthlyBills === null) missingData.push("monthly bills");
  if (monthlyDebtPayments === null) missingData.push("debt payments");
  if (cash === null) missingData.push("cash balances");
  if (totalDebt === null) missingData.push("debt balances");
  if (investments === null && retirement === null) missingData.push("investment accounts");

  let healthScore: number | null = null;
  if (monthlyNetIncome !== null && monthlyNeeds !== null && cash !== null && totalDebt !== null) {
    const cashFlowScore = monthlyCashFlow !== null && monthlyCashFlow > 0
      ? Math.min(25, Math.round((monthlyCashFlow / Math.max(monthlyNetIncome, 1)) * 100))
      : 0;
    const emergencyScore = emergencyFundMonths !== null
      ? emergencyFundMonths >= 6 ? 25 : emergencyFundMonths >= 3 ? 18 : emergencyFundMonths >= 1 ? 10 : 3
      : 0;
    const debtScore = highInterestDebt === 0
      ? 25
      : totalDebt === 0
        ? 25
        : Math.max(0, 25 - Math.round(((highInterestDebt ?? totalDebt) / Math.max(monthlyNetIncome * 12, 1)) * 25));
    const creditScore = creditUtilization === null
      ? 10
      : creditUtilization <= 10 ? 25 : creditUtilization <= 30 ? 18 : creditUtilization <= 50 ? 10 : 3;
    healthScore = Math.max(0, Math.min(100, cashFlowScore + emergencyScore + debtScore + creditScore));
  }

  return {
    netWorth: metric(netWorth),
    cash: metric(cash),
    investments: metric(sumKnown([investments, retirement])),
    debt: metric(totalDebt),
    monthlyCashFlow: metric(monthlyCashFlow),
    emergencyFundMonths: metric(emergencyFundMonths),
    healthScore,
    taxEstimate: raw.latestTaxEstimate ?? null,
    nextBestMove: chooseNextBestMove({
      monthlyNetIncome,
      monthlyCashFlow,
      cash,
      monthlyNeeds,
      highInterestDebt,
      creditUtilization,
      employerMatchCaptured: raw.employerMatchCaptured ?? null,
      taxEstimate: raw.latestTaxEstimate ?? null,
      missingData,
    }),
    missingData,
  };
}
