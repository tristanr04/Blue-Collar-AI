import React, { useState } from 'react';
import { Calculator, Zap, TrendingDown, DollarSign, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/lib/store';

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

function calcMonthly(
  hourlyRate: number,
  regHrs: number,
  otHrs: number,
  dtHrs: number,
  perDiem: number,
  taxRate: number,
  extraOtHrs: number,
  extraDtHrs: number,
  expenseCut: number,
  totalBills: number,
  totalDebtMins: number
) {
  const totalOt = otHrs + extraOtHrs;
  const totalDt = dtHrs + extraDtHrs;
  const weeklyGross = regHrs * hourlyRate + totalOt * hourlyRate * 1.5 + totalDt * hourlyRate * 2 + perDiem;
  const weeklyNet = weeklyGross * (1 - taxRate);
  const monthly = weeklyNet * 4.33;
  const expenses = totalBills + totalDebtMins - expenseCut;
  const free = monthly - Math.max(0, expenses);
  return { monthly, free, weeklyGross, weeklyNet };
}

export default function Scenario() {
  const { profile, paystubs, debts, bills } = useStore();

  const [extraOt, setExtraOt] = useState(0);
  const [extraDt, setExtraDt] = useState(0);
  const [expenseCut, setExpenseCut] = useState(0);
  const [extraDebt, setExtraDebt] = useState(0);
  const [result, setResult] = useState<null | { base: ReturnType<typeof calcMonthly>; scenario: ReturnType<typeof calcMonthly>; debtPayoff: number | null }>(null);

  const lastStub = paystubs[paystubs.length - 1];
  const hourlyRate = profile?.hourlyRate ?? 0;
  const regHrs = lastStub?.regularHours ?? 40;
  const otHrs = lastStub?.overtimeHours ?? 0;
  const dtHrs = lastStub?.doubleTimeHours ?? 0;
  const perDiem = lastStub?.perDiem ?? 0;
  const taxRate = profile?.filingContext === 'Married' ? 0.18 : 0.22;
  const totalBills = bills.reduce((s, b) => s + b.amount, 0);
  const totalDebtMins = debts.reduce((s, d) => s + d.minimumPayment, 0);
  const totalDebtBalance = debts.reduce((s, d) => s + d.balance, 0);

  const runScenario = () => {
    const base = calcMonthly(hourlyRate, regHrs, otHrs, dtHrs, perDiem, taxRate, 0, 0, 0, totalBills, totalDebtMins);
    const scenario = calcMonthly(hourlyRate, regHrs, otHrs, dtHrs, perDiem, taxRate, extraOt, extraDt, expenseCut, totalBills, totalDebtMins);
    const totalPayment = totalDebtMins + extraDebt;
    const debtPayoff = totalPayment > 0 && totalDebtBalance > 0 ? Math.ceil(totalDebtBalance / totalPayment) : null;
    setResult({ base, scenario, debtPayoff });
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Scenario Builder</h1>
        <p className="text-muted-foreground mt-1 text-sm">See how extra shifts or expense cuts change your financial picture.</p>
      </div>

      {!profile && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex gap-3">
          <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-200">Complete your profile first to get accurate scenario projections.</p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Controls */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="w-5 h-5 text-primary" /> Adjustments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1">
              <Label>Extra Overtime hours/week</Label>
              <Input type="number" min="0" max="40" value={extraOt} onChange={e => setExtraOt(Number(e.target.value))} className="h-12 text-lg" />
              {hourlyRate > 0 && <div className="text-xs text-muted-foreground">{money(extraOt * hourlyRate * 1.5 * 4.33)}/mo additional</div>}
            </div>
            <div className="space-y-1">
              <Label>Extra Double Time hours/week</Label>
              <Input type="number" min="0" max="20" value={extraDt} onChange={e => setExtraDt(Number(e.target.value))} className="h-12 text-lg" />
              {hourlyRate > 0 && <div className="text-xs text-muted-foreground">{money(extraDt * hourlyRate * 2 * 4.33)}/mo additional</div>}
            </div>
            <div className="space-y-1">
              <Label>Monthly expense reduction ($)</Label>
              <Input type="number" min="0" value={expenseCut} onChange={e => setExpenseCut(Number(e.target.value))} className="h-12 text-lg" placeholder="0" />
              <div className="text-xs text-muted-foreground">e.g. cancel subscriptions, reduce dining</div>
            </div>
            <div className="space-y-1">
              <Label>Extra debt payment/month ($)</Label>
              <Input type="number" min="0" value={extraDebt} onChange={e => setExtraDebt(Number(e.target.value))} className="h-12 text-lg" placeholder="0" />
              {totalDebtBalance > 0 && <div className="text-xs text-muted-foreground">Total debt: {money(totalDebtBalance)}</div>}
            </div>
            <Button className="w-full h-12 text-base bg-primary hover:bg-primary/90 text-primary-foreground" onClick={runScenario}>
              <Zap className="w-4 h-4 mr-2" /> Run Scenario
            </Button>
          </CardContent>
        </Card>

        {/* Results */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingDown className="w-5 h-5 text-primary" /> Projected Result
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result === null ? (
              <div className="text-center py-12 text-muted-foreground">
                <Calculator className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p className="font-medium">Enter adjustments and run the scenario.</p>
                <p className="text-sm mt-1">Results will appear here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-accent rounded-xl p-4 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Current monthly take-home</span>
                    <span className="font-semibold">{money(result.base.monthly)}</span>
                  </div>
                  <div className="flex justify-between text-primary font-semibold">
                    <span className="text-sm">Scenario take-home</span>
                    <span className="text-lg">{money(result.scenario.monthly)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Monthly increase</span>
                    <span className={`font-semibold ${result.scenario.monthly > result.base.monthly ? 'text-primary' : 'text-muted-foreground'}`}>
                      +{money(result.scenario.monthly - result.base.monthly)}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Current free cash flow</span>
                    <span className="font-semibold">{money(result.base.free)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Scenario free cash flow</span>
                    <span className={`font-semibold ${result.scenario.free - extraDebt > result.base.free ? 'text-primary' : ''}`}>
                      {money(result.scenario.free - extraDebt)}
                    </span>
                  </div>
                  {result.debtPayoff && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Est. debt-free in</span>
                      <span className="font-semibold text-foreground">{result.debtPayoff} months</span>
                    </div>
                  )}
                </div>

                <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 text-xs text-muted-foreground">
                  Estimates use a simplified tax rate and do not account for interest compounding on debts. Confirm values with your actual paystubs.
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
