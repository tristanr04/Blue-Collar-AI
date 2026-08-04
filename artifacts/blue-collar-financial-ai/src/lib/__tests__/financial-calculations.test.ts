import assert from 'node:assert/strict';
import test from 'node:test';
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
} from '../financial-calculations.js';

const paystubs = [
  { date: '2026-07-01', grossPay: 1000, netPay: 800 },
  { date: '2026-07-22', grossPay: 2000, netPay: 1500 },
  { date: '2026-07-15', grossPay: 1500, netPay: 1150 },
];

test('sorts paystubs by actual date instead of array position', () => {
  assert.equal(sortPaystubsNewestFirst(paystubs)[0].date, '2026-07-22');
});

test('uses the newest dated paystub for monthly income', () => {
  const calculated = monthlyIncomeFromLatestPaystub(paystubs, 'Weekly', 'grossPay');
  assert.ok(calculated.value);
  assert.equal(Math.round(calculated.value), Math.round(2000 * (52 / 12)));
});

test('calculates trailing average income from newest valid paystubs', () => {
  const calculated = trailingAverageMonthlyIncome(paystubs, 'Weekly', 'grossPay', 3);
  assert.ok(calculated.value);
  assert.equal(Math.round(calculated.value), Math.round(1500 * (52 / 12)));
  assert.equal(calculated.completeness, 'complete');
});

test('calculates median monthly income', () => {
  const calculated = medianMonthlyIncome(paystubs, 'Weekly', 'grossPay');
  assert.ok(calculated.value);
  assert.equal(Math.round(calculated.value), Math.round(1500 * (52 / 12)));
});

test('DTI uses gross monthly income', () => {
  const calculated = grossDebtToIncome(5000, [
    { balance: 10000, minimumPayment: 500 },
    { balance: 2000, minimumPayment: 100 },
  ]);
  assert.equal(calculated.value, 12);
});

test('net obligation ratio remains separate from DTI', () => {
  const calculated = netObligationRatio(
    4000,
    [{ balance: 10000, minimumPayment: 500 }],
    [{ amount: 1500 }],
  );
  assert.equal(calculated.value, 50);
});

test('utilization uses only revolving accounts with actual credit limits', () => {
  const calculated = revolvingCreditUtilization([
    { balance: 3000, minimumPayment: 100, creditLimit: 10000, isRevolving: true },
    { balance: 20000, minimumPayment: 500, interestRate: 8, isRevolving: false },
  ]);
  assert.equal(calculated.value, 30);
});

test('utilization is incomplete when no credit limit exists', () => {
  const calculated = revolvingCreditUtilization([
    { balance: 3000, minimumPayment: 100, interestRate: 25, isRevolving: true },
  ]);
  assert.equal(calculated.value, null);
  assert.equal(calculated.completeness, 'insufficient');
});

test('free cash flow uses net income minus bills and debt payments', () => {
  const calculated = freeCashFlow(
    5000,
    [{ balance: 10000, minimumPayment: 500 }],
    [{ amount: 1500 }, { amount: 200 }],
  );
  assert.equal(calculated.value, 2800);
});

test('emergency fund excludes investment accounts from liquid cash', () => {
  const calculated = emergencyFundMonths(
    [
      { value: 6000, type: 'Cash' },
      { value: 50000, type: 'Investment' },
    ],
    [{ balance: 10000, minimumPayment: 500 }],
    [{ amount: 1500 }],
  );
  assert.equal(calculated.value, 3);
});

test('net worth subtracts debt from all assets', () => {
  const calculated = netWorth(
    [
      { value: 5000, type: 'Cash' },
      { value: 20000, type: 'Investment' },
    ],
    [{ balance: 10000, minimumPayment: 300 }],
  );
  assert.equal(calculated.value, 15000);
});
