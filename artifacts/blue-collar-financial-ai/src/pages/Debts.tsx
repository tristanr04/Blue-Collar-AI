import React, { useState } from 'react';
import { Plus, Trash2, TrendingDown, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useStore } from '@/lib/store';

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

const EMPTY = { name: '', balance: 0, interestRate: 0, minimumPayment: 0 };

export default function Debts() {
  const { debts, paystubs, addDebt, removeDebt } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const totalDebt = debts.reduce((s, d) => s + d.balance, 0);
  const totalMinPayments = debts.reduce((s, d) => s + d.minimumPayment, 0);
  const monthlyIncome = paystubs.reduce((s, p) => s + p.netPay, 0);
  const debtToIncome = monthlyIncome > 0 ? (totalMinPayments / monthlyIncome) * 100 : 0;

  const handleSave = () => {
    if (!form.name || form.balance <= 0) return;
    addDebt({ name: form.name, balance: Number(form.balance), interestRate: Number(form.interestRate), minimumPayment: Number(form.minimumPayment) });
    setForm({ ...EMPTY });
    setShowForm(false);
  };

  const highestAPR = debts.length > 0 ? [...debts].sort((a, b) => b.interestRate - a.interestRate)[0] : null;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Debts</h1>
          <p className="text-muted-foreground mt-1 text-sm">Track what you owe and plan your payoff.</p>
        </div>
        <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4 mr-1" /> Add Debt
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="border-border shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground font-medium">Total Owed</div>
            <div className="text-2xl font-bold text-destructive mt-1">{money(totalDebt)}</div>
          </CardContent>
        </Card>
        <Card className="border-border shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground font-medium">Min. Payments/mo</div>
            <div className="text-2xl font-bold text-foreground mt-1">{money(totalMinPayments)}</div>
          </CardContent>
        </Card>
        <Card className="border-border shadow-sm col-span-2 md:col-span-1">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground font-medium">Debt-to-Income</div>
            <div className={`text-2xl font-bold mt-1 ${debtToIncome > 36 ? 'text-destructive' : 'text-primary'}`}>{debtToIncome.toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground mt-1">{debtToIncome > 36 ? 'Above recommended 36%' : 'Within healthy range'}</div>
          </CardContent>
        </Card>
      </div>

      {highestAPR && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-amber-900 dark:text-amber-200 text-sm">Highest-cost debt: {highestAPR.name}</div>
            <div className="text-sm text-amber-700 dark:text-amber-300 mt-0.5">
              {highestAPR.interestRate}% APR — paying this off first saves the most money.
            </div>
          </div>
        </div>
      )}

      {/* Add Form */}
      {showForm && (
        <Card className="border-primary/30 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Add Debt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Car Loan, Credit Card" className="h-12" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Balance ($)</Label>
                <Input type="number" min="0" value={form.balance || ''} onChange={e => setForm(f => ({ ...f, balance: Number(e.target.value) }))} className="h-12" placeholder="0" />
              </div>
              <div className="space-y-1">
                <Label>APR (%)</Label>
                <Input type="number" min="0" step="0.1" value={form.interestRate || ''} onChange={e => setForm(f => ({ ...f, interestRate: Number(e.target.value) }))} className="h-12" placeholder="0" />
              </div>
              <div className="space-y-1">
                <Label>Min. Payment ($)</Label>
                <Input type="number" min="0" value={form.minimumPayment || ''} onChange={e => setForm(f => ({ ...f, minimumPayment: Number(e.target.value) }))} className="h-12" placeholder="0" />
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 h-12" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1 h-12 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleSave}>Save</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Debt List */}
      {debts.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <TrendingDown className="w-14 h-14 mx-auto mb-4 opacity-30" />
          <p className="font-medium">No debts added yet.</p>
          <p className="text-sm mt-1">Add your loans and credit cards to see your full picture.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {debts.map(debt => {
            const payoffMonths = debt.minimumPayment > 0 ? Math.ceil(debt.balance / debt.minimumPayment) : null;
            return (
              <Card key={debt.id} className="border-border shadow-sm">
                <CardContent className="p-4">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="font-semibold text-foreground">{debt.name}</div>
                      <div className="flex gap-3 mt-1 text-sm text-muted-foreground">
                        <span>{debt.interestRate}% APR</span>
                        <span>•</span>
                        <span>{money(debt.minimumPayment)}/mo min</span>
                        {payoffMonths && <span>• ~{payoffMonths} mo payoff</span>}
                      </div>
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>Balance: {money(debt.balance)}</span>
                        </div>
                        <Progress value={Math.min((1 - debt.balance / (debt.balance * 1.5)) * 100, 30)} className="h-2" />
                      </div>
                    </div>
                    <div className="ml-4 flex flex-col items-end gap-2">
                      <div className="text-xl font-bold text-destructive">{money(debt.balance)}</div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeDebt(debt.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
