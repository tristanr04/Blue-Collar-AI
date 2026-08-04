export interface TrustedFinancialSnapshot {
  monthlyGrossIncome: number | null;
  monthlyNetIncome: number | null;
  monthlyBills: number;
  monthlyDebtPayments: number;
  totalDebtBalance: number;
  liquidCash: number;
  totalAssets: number;
  hourlyRate: number | null;
}

export interface TrustedCalculation {
  name: string;
  value: number | null;
  unit: 'currency' | 'percent' | 'months' | 'hours';
  formula: string;
  inputs: Record<string, number>;
  warning?: string;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function sumArray(value: unknown, fieldNames: string[]): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce((sum, item) => {
    if (!item || typeof item !== 'object') return sum;
    const record = item as Record<string, unknown>;
    for (const field of fieldNames) {
      const parsed = numberOrNull(record[field]);
      if (parsed !== null) return sum + parsed;
    }
    return sum;
  }, 0);
}

function nestedNumber(profile: Record<string, unknown>, paths: string[][]): number | null {
  for (const path of paths) {
    let current: unknown = profile;
    for (const key of path) {
      if (!current || typeof current !== 'object') {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[key];
    }
    const parsed = numberOrNull(current);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function buildTrustedSnapshot(profile: Record<string, unknown>): TrustedFinancialSnapshot {
  const debts = profile.debts;
  const bills = profile.bills;
  const assets = profile.assets;

  const monthlyGrossIncome = nestedNumber(profile, [
    ['computed', 'monthlyGross'],
    ['monthlyGross'],
    ['monthlyGrossIncome'],
  ]);
  const monthlyNetIncome = nestedNumber(profile, [
    ['computed', 'monthlyNet'],
    ['monthlyNet'],
    ['monthlyNetIncome'],
  ]);

  const computedBills = nestedNumber(profile, [['computed', 'totalBills'], ['totalBills']]);
  const computedDebtPayments = nestedNumber(profile, [['computed', 'totalDebtMin'], ['totalDebtMin']]);
  const computedDebtBalance = nestedNumber(profile, [['computed', 'totalDebt'], ['totalDebt']]);
  const computedLiquidCash = nestedNumber(profile, [['computed', 'liquidCash'], ['liquidCash']]);

  return {
    monthlyGrossIncome,
    monthlyNetIncome,
    monthlyBills: computedBills ?? sumArray(bills, ['amount']),
    monthlyDebtPayments: computedDebtPayments ?? sumArray(debts, ['minimumPayment', 'monthlyPayment']),
    totalDebtBalance: computedDebtBalance ?? sumArray(debts, ['balance', 'currentBalance']),
    liquidCash:
      computedLiquidCash ??
      (Array.isArray(assets)
        ? assets.reduce((sum, item) => {
            if (!item || typeof item !== 'object') return sum;
            const record = item as Record<string, unknown>;
            if (record.type !== 'Cash') return sum;
            return sum + (numberOrNull(record.value) ?? 0);
          }, 0)
        : 0),
    totalAssets: sumArray(assets, ['value', 'currentBalance']),
    hourlyRate: nestedNumber(profile, [['profile', 'hourlyRate'], ['hourlyRate']]),
  };
}

export function calculateTrustedMetrics(snapshot: TrustedFinancialSnapshot): TrustedCalculation[] {
  const calculations: TrustedCalculation[] = [];

  calculations.push({
    name: 'Free cash flow',
    value:
      snapshot.monthlyNetIncome === null
        ? null
        : snapshot.monthlyNetIncome - snapshot.monthlyBills - snapshot.monthlyDebtPayments,
    unit: 'currency',
    formula: 'monthly net income − monthly bills − monthly debt payments',
    inputs: {
      monthlyNetIncome: snapshot.monthlyNetIncome ?? 0,
      monthlyBills: snapshot.monthlyBills,
      monthlyDebtPayments: snapshot.monthlyDebtPayments,
    },
    warning: snapshot.monthlyNetIncome === null ? 'Monthly net income is missing.' : undefined,
  });

  calculations.push({
    name: 'Debt-to-income ratio',
    value:
      snapshot.monthlyGrossIncome && snapshot.monthlyGrossIncome > 0
        ? (snapshot.monthlyDebtPayments / snapshot.monthlyGrossIncome) * 100
        : null,
    unit: 'percent',
    formula: 'monthly debt payments ÷ gross monthly income × 100',
    inputs: {
      monthlyDebtPayments: snapshot.monthlyDebtPayments,
      monthlyGrossIncome: snapshot.monthlyGrossIncome ?? 0,
    },
    warning: snapshot.monthlyGrossIncome === null ? 'Gross monthly income is missing.' : undefined,
  });

  const monthlyObligations = snapshot.monthlyBills + snapshot.monthlyDebtPayments;
  calculations.push({
    name: 'Emergency fund coverage',
    value: monthlyObligations > 0 ? snapshot.liquidCash / monthlyObligations : null,
    unit: 'months',
    formula: 'liquid cash ÷ monthly bills and debt payments',
    inputs: {
      liquidCash: snapshot.liquidCash,
      monthlyObligations,
    },
    warning: monthlyObligations <= 0 ? 'Monthly obligations are missing.' : undefined,
  });

  calculations.push({
    name: 'Net worth',
    value: snapshot.totalAssets - snapshot.totalDebtBalance,
    unit: 'currency',
    formula: 'total assets − total debt balance',
    inputs: {
      totalAssets: snapshot.totalAssets,
      totalDebtBalance: snapshot.totalDebtBalance,
    },
  });

  return calculations;
}

export function sanitizeProfileForExplanation(profile: Record<string, unknown>): Record<string, unknown> {
  const snapshot = buildTrustedSnapshot(profile);
  return {
    snapshot,
    calculations: calculateTrustedMetrics(snapshot),
  };
}
