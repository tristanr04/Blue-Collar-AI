import React, { useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { Plus, ArrowRight, TrendingUp, PiggyBank, Target, UploadCloud } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useStore } from '@/lib/store';

export default function Dashboard() {
  const [_, setLocation] = useLocation();
  const { profile, paystubs, bills, debts, assets } = useStore();

  useEffect(() => {
    if (profile && !profile.hasCompletedOnboarding) {
      setLocation('/welcome');
    } else if (!profile) {
      setLocation('/welcome');
    }
  }, [profile, setLocation]);

  if (!profile) return null;

  // Simple aggregations for dashboard
  const currentMonthStubs = paystubs; // Assume all are this month for now
  const monthlyTakeHome = currentMonthStubs.reduce((acc, curr) => acc + curr.netPay, 0);
  
  const totalBills = bills.reduce((acc, b) => acc + b.amount, 0);
  const totalDebtMins = debts.reduce((acc, d) => acc + d.minimumPayment, 0);
  
  const freeCashFlow = monthlyTakeHome - totalBills - totalDebtMins;
  
  const totalCash = assets.filter(a => a.type === 'Cash').reduce((acc, a) => acc + a.value, 0);
  const totalDebt = debts.reduce((acc, d) => acc + d.balance, 0);
  const netWorth = assets.reduce((acc, a) => acc + a.value, 0) - totalDebt;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Hello, {profile.name}</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Here is your financial snapshot.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="bg-white dark:bg-slate-900" onClick={() => setLocation('/documents')}>
            <UploadCloud className="w-4 h-4 mr-2" /> Upload Docs
          </Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setLocation('/paystubs')}>
            <Plus className="w-4 h-4 mr-2" /> Add Paystub
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Free Cash Flow */}
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Available Cash Flow</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900 dark:text-white">${freeCashFlow.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <p className="text-xs text-slate-500 mt-1">Take home minus bills & min payments</p>
          </CardContent>
        </Card>

        {/* Emergency Fund */}
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Liquid Cash</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900 dark:text-white">${totalCash.toLocaleString()}</div>
            <p className="text-xs text-slate-500 mt-1">Ready for emergencies</p>
          </CardContent>
        </Card>

        {/* Net Worth */}
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Net Worth</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900 dark:text-white">${netWorth.toLocaleString()}</div>
            <p className="text-xs text-slate-500 mt-1">Assets minus all debts</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Next Moves */}
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-emerald-600" />
              Recommended Next Moves
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4">
              <li className="flex gap-4 items-start">
                <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-700 dark:text-emerald-400 flex-shrink-0 mt-0.5">
                  1
                </div>
                <div>
                  <h4 className="font-semibold text-slate-900 dark:text-slate-100">Upload your latest paystub</h4>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Keep your take-home estimates accurate by scanning your recent pay.</p>
                </div>
              </li>
              <li className="flex gap-4 items-start">
                <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400 flex-shrink-0 mt-0.5">
                  2
                </div>
                <div>
                  <h4 className="font-semibold text-slate-900 dark:text-slate-100">Add remaining bills</h4>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">You have ${totalBills.toLocaleString()} logged. Make sure auto-pay utilities are included.</p>
                </div>
              </li>
              <li className="flex gap-4 items-start">
                <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400 flex-shrink-0 mt-0.5">
                  3
                </div>
                <div>
                  <h4 className="font-semibold text-slate-900 dark:text-slate-100">Run an overtime scenario</h4>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">See how a 10-hour weekend shift impacts your debt payoff.</p>
                </div>
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Quick Links */}
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {paystubs.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <PiggyBank className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-700 mb-3" />
                <p>No paystubs recorded yet.</p>
                <Button variant="link" className="text-emerald-600" onClick={() => setLocation('/paystubs')}>Add one now</Button>
              </div>
            ) : (
              <div className="space-y-4">
                {paystubs.slice(0, 3).map(stub => (
                  <div key={stub.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                    <div>
                      <div className="font-medium text-slate-900 dark:text-slate-100">Paystub: {stub.employer}</div>
                      <div className="text-xs text-slate-500">{new Date(stub.date).toLocaleDateString()}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-emerald-600 dark:text-emerald-400">${stub.netPay.toLocaleString()}</div>
                      <div className="text-xs text-slate-500">Net Pay</div>
                    </div>
                  </div>
                ))}
                <Button variant="outline" className="w-full mt-4" onClick={() => setLocation('/paystubs')}>
                  View All History
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
