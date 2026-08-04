export type Completeness = 'complete' | 'partial' | 'insufficient';

export interface CalculationResult<T> {
  value: T | null;
  formula: string;
  inputs: Record<string, unknown>;
  completeness: Completeness;
  warnings: string[];
  calculatedAt: string;
}

export interface PaystubInput {
  date: string;
  grossPay: number;
  netPay: number;
  regularHours?: number;
  overtimeHours?: number;
  doubleTimeHours?: number;
  perDiem?: number;
  bonus?: number;
}

export type PayFrequency = 'Weekly' | 'Bi-Weekly' | 'Semi-Monthly' | 'Monthly';

export interface DebtInput {
  balance: number;
  minimumPayment: number;
  interestRate?: number;
  creditLimit?: number;
  isRevolving?: boolean;
}

export interface BillInput {
  amount: number;
}

export interface AssetInput {
  value: number;
  type: 'Cash' | 'Investment' | 'Other';
}

const FREQUENCY_MULTIPLIER: Record<PayFrequency, number> = {
  Weekly: 52 / 12,
  'Bi-Weekly': 26 / 12,
  'Semi-Monthly': 2,
  Monthly: 1,
};

function now(): string {
  return new Date().toISOString();
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function result<T>(
  value: T | null,
  formula: string,
  inputs: Record<string, unknown>,
  completeness: Completeness,
  warnings: string[] = [],
): CalculationResult<T> {
  return { value, formula, inputs, completeness, warnings, calculatedAt: now() };
}

export function sortPaystubsNewestFirst(paystubs: PaystubInput[]): PaystubInput[] {
  return [...paystubs].sort((a, b) => {
    const aTime = Date.parse(a.date);
    const bTime = Date.parse(b.date);
    if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) return 0;
    if (!Number.isFinite(aTime)) return 1;
    if (!Number.isFinite(bTime)) return -1;
    return bTime - aTime;
  });
}

export function monthlyIncomeFromLatestPaystub(
  paystubs: PaystubInput[],
  frequency: PayFrequency,
  field: 'grossPay' | 'netPay',
): CalculationResult<number> {
  const sorted = sortPaystubsNewestFirst(paystubs);
  const latest = sorted[0];
  if (!latest) {
    return result(null, `${field} × pay-frequency multiplier`, { frequency }, 'insufficient', [
      'No paystub is available.',
    ]);
  }

  const amount = finiteNonNegative(latest[field]);
  if (amount === 0) {
    return result(null, `${field} × pay-frequency multiplier`, { frequency, latest }, 'insufficient', [
      `Latest paystub does not contain a valid ${field}.`,
    ]);
  }

  const multiplier = FREQUENCY_MULTIPLIER[frequency];
  return result(
    amount * multiplier,
    `${field} × ${multiplier}`,
    { latestPaystubDate: latest.date, amount, frequency, multiplier },
    'complete',
  );
}

export function trailingAverageMonthlyIncome(
  paystubs: PaystubInput[],
  frequency: PayFrequency,
  field: 'grossPay' | 'netPay',
  count = 4,
): CalculationResult<number> {
  const valid = sortPaystubsNewestFirst(paystubs)
    .filter((stub) => Number.isFinite(stub[field]) && stub[field] > 0)
    .slice(0, count);

  if (valid.length === 0) {
    return result(null, `average(${field}) × pay-frequency multiplier`, { frequency, count }, 'insufficient', [
      'No valid paystubs are available.',
    ]);
  }

  const average = valid.reduce((sum, stub) => sum + stub[field], 0) / valid.length;
  const multiplier = FREQUENCY_MULTIPLIER[frequency];
  return result(
    average * multiplier,
    `average of ${valid.length} ${field} values × ${multiplier}`,
    { dates: valid.map((stub) => stub.date), values: valid.map((stub) => stub[field]), multiplier },
    valid.length >= count ? 'complete' : 'partial',
    valid.length >= count ? [] : [`Only ${valid.length} valid paystub(s) were available.`],
  );
}

export function medianMonthlyIncome(
  paystubs: PaystubInput[],
  frequency: PayFrequency,
  field: 'grossPay' | 'netPay',
): CalculationResult<number> {
  const values = paystubs
    .map((stub) => stub[field])
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (values.length === 0) {
    return result(null, `median(${field}) × pay-frequency multiplier`, { frequency }, 'insufficient', [
      'No valid paystub values are available.',
    ]);
  }

  const middle = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
  const multiplier = FREQUENCY_MULTIPLIER[frequency];
  return result(median * multiplier, `median(${field}) × ${multiplier}`, { values, multiplier }, 'complete');
}

export function grossDebtToIncome(
  grossMonthlyIncome: number | null,
  debts: DebtInput[],
): CalculationResult<number> {
  const monthlyDebtPayments = debts.reduce(
    (sum, debt) => sum + finiteNonNegative(debt.minimumPayment),
    0,
  );

  if (!grossMonthlyIncome || grossMonthlyIncome <= 0) {
    return result(null, 'monthly debt payments ÷ gross monthly income × 100', { monthlyDebtPayments }, 'insufficient', [
      'Gross monthly income is required for DTI.',
    ]);
  }

  return result(
    (monthlyDebtPayments / grossMonthlyIncome) * 100,
    'monthly debt payments ÷ gross monthly income × 100',
    { monthlyDebtPayments, grossMonthlyIncome },
    'complete',
  );
}

export function netObligationRatio(
  netMonthlyIncome: number | null,
  debts: DebtInput[],
  bills: BillInput[],
): CalculationResult<number> {
  const debtPayments = debts.reduce((sum, debt) => sum + finiteNonNegative(debt.minimumPayment), 0);
  const billPayments = bills.reduce((sum, bill) => sum + finiteNonNegative(bill.amount), 0);
  const obligations = debtPayments + billPayments;

  if (!netMonthlyIncome || netMonthlyIncome <= 0) {
    return result(null, 'monthly obligations ÷ net monthly income × 100', { obligations }, 'insufficient', [
      'Net monthly income is required.',
    ]);
  }

  return result(
    (obligations / netMonthlyIncome) * 100,
    'monthly obligations ÷ net monthly income × 100',
    { debtPayments, billPayments, obligations, netMonthlyIncome },
    'complete',
  );
}

export function revolvingCreditUtilization(debts: DebtInput[]): CalculationResult<number> {
  const revolving = debts.filter(
    (debt) => debt.isRevolving === true && Number.isFinite(debt.creditLimit) && (debt.creditLimit ?? 0) > 0,
  );

  if (revolving.length === 0) {
    return result(null, 'revolving balances ÷ revolving credit limits × 100', {}, 'insufficient', [
      'No revolving account with a valid credit limit is available.',
    ]);
  }

  const balance = revolving.reduce((sum, debt) => sum + finiteNonNegative(debt.balance), 0);
  const limit = revolving.reduce((sum, debt) => sum + finiteNonNegative(debt.creditLimit ?? 0), 0);
  return result(
    (balance / limit) * 100,
    'revolving balances ÷ revolving credit limits × 100',
    { balance, limit, accountCount: revolving.length },
    'complete',
  );
}

export function freeCashFlow(
  netMonthlyIncome: number | null,
  debts: DebtInput[],
  bills: BillInput[],
): CalculationResult<number> {
  if (netMonthlyIncome === null || netMonthlyIncome < 0) {
    return result(null, 'net income − bills − debt payments', {}, 'insufficient', [
      'Net monthly income is required.',
    ]);
  }
  const billsTotal = bills.reduce((sum, bill) => sum + finiteNonNegative(bill.amount), 0);
  const debtPayments = debts.reduce((sum, debt) => sum + finiteNonNegative(debt.minimumPayment), 0);
  return result(
    netMonthlyIncome - billsTotal - debtPayments,
    'net income − bills − debt payments',
    { netMonthlyIncome, billsTotal, debtPayments },
    'complete',
  );
}

export function emergencyFundMonths(
  assets: AssetInput[],
  debts: DebtInput[],
  bills: BillInput[],
): CalculationResult<number> {
  const liquidCash = assets
    .filter((asset) => asset.type === 'Cash')
    .reduce((sum, asset) => sum + finiteNonNegative(asset.value), 0);
  const monthlyExpenses =
    debts.reduce((sum, debt) => sum + finiteNonNegative(debt.minimumPayment), 0) +
    bills.reduce((sum, bill) => sum + finiteNonNegative(bill.amount), 0);

  if (monthlyExpenses <= 0) {
    return result(null, 'liquid cash ÷ monthly obligations', { liquidCash }, 'insufficient', [
      'Monthly obligations are required.',
    ]);
  }

  return result(
    liquidCash / monthlyExpenses,
    'liquid cash ÷ monthly obligations',
    { liquidCash, monthlyExpenses },
    'complete',
  );
}

export function netWorth(assets: AssetInput[], debts: DebtInput[]): CalculationResult<number> {
  const totalAssets = assets.reduce((sum, asset) => sum + finiteNonNegative(asset.value), 0);
  const totalDebt = debts.reduce((sum, debt) => sum + finiteNonNegative(debt.balance), 0);
  return result(totalAssets - totalDebt, 'total assets − total debt', { totalAssets, totalDebt }, 'complete');
}
