import { describe, expect, it } from 'vitest';
import {
  emergencyFundMonths,
  freeCashFlow,
  grossDebtToIncome,
  medianMonthlyIncome,
  monthlyIncomeFromLatestPaystub,
  netObligationRatio,
  netWorth,
  revolvingCreditUtilization,
  sortPaystubsNewestFirst,
  trailingAverageMonthlyIncome,
} from '../financial-calculations';

const paystubs = [
  { date: '2026-07-01', grossPay: 1000, netPay: 800 },
  { date: '2026-07-22', grossPay: 2000, netPay: 1500 },
  { date: '2026-07-15', grossPay: 1500, netPay: 1150 },
];

describe('financial-calculations', () => {
  it('sorts paystubs by actual date instead of array position', () => {
    expect(sortPaystubsNewestFirst(paystubs)[0].date).toBe('2026-07-22');
  });

  it('uses the newest dated paystub for monthly income', () => {
    const calculated = monthlyIncomeFromLatestPaystub(paystubs, 'Weekly', 'grossPay');
    expect(calculated.value).toBeTruthy();
    expect(Math.round(calculated.value!)).toBe(Math.round(2000 * (52 / 12)));
  });

  it('calculates trailing average income from newest valid paystubs', () => {
    const calculated = trailingAverageMonthlyIncome(paystubs, 'Weekly', 'grossPay', 3);
    expect(calculated.value).toBeTruthy();
    expect(Math.round(calculated.value!)).toBe(Math.round(1500 * (52 / 12)));
    expect(calculated.completeness).toBe('complete');
  });

  it('calculates median monthly income', () => {
    const calculated = medianMonthlyIncome(paystubs, 'Weekly', 'grossPay');
    expect(calculated.value).toBeTruthy();
    expect(Math.round(calculated.value!)).toBe(Math.round(1500 * (52 / 12)));
  });

  it('DTI uses gross monthly income', () => {
    const calculated = grossDebtToIncome(5000, [
      { balance: 10000, minimumPayment: 500 },
      { balance: 2000, minimumPayment: 100 },
    ]);
    expect(calculated.value).toBe(12);
  });

  it('net obligation ratio remains separate from DTI', () => {
    const calculated = netObligationRatio(
      4000,
      [{ balance: 10000, minimumPayment: 500 }],
      [{ amount: 1500 }],
    );
    expect(calculated.value).toBe(50);
  });

  it('utilization uses only revolving accounts with actual credit limits', () => {
    const calculated = revolvingCreditUtilization([
      { balance: 3000, minimumPayment: 100, creditLimit: 10000, isRevolving: true },
      { balance: 20000, minimumPayment: 500, interestRate: 8, isRevolving: false },
    ]);
    expect(calculated.value).toBe(30);
  });

  it('utilization is incomplete when no credit limit exists', () => {
    const calculated = revolvingCreditUtilization([
      { balance: 3000, minimumPayment: 100, interestRate: 25, isRevolving: true },
    ]);
    expect(calculated.value).toBeNull();
    expect(calculated.completeness).toBe('insufficient');
  });

  it('free cash flow uses net income minus bills and debt payments', () => {
    const calculated = freeCashFlow(
      5000,
      [{ balance: 10000, minimumPayment: 500 }],
      [{ amount: 1500 }, { amount: 200 }],
    );
    expect(calculated.value).toBe(2800);
  });

  it('emergency fund excludes investment accounts from liquid cash', () => {
    const calculated = emergencyFundMonths(
      [
        { value: 6000, type: 'Cash' },
        { value: 50000, type: 'Investment' },
      ],
      [{ balance: 10000, minimumPayment: 500 }],
      [{ amount: 1500 }],
    );
    expect(calculated.value).toBe(3);
  });

  it('net worth subtracts debt from all assets', () => {
    const calculated = netWorth(
      [
        { value: 5000, type: 'Cash' },
        { value: 20000, type: 'Investment' },
      ],
      [{ balance: 10000, minimumPayment: 300 }],
    );
    expect(calculated.value).toBe(15000);
  });
});
