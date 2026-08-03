import React, { useState } from 'react';
import { Plus, Trash2, Landmark, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/lib/store';

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

const EMPTY = { name: '', type: 'Cash' as 'Cash' | 'Investment' | 'Other', value: 0 };

export default function Banking() {
  const { assets, bills, addAsset, removeAsset } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const cashAssets = assets.filter(a => a.type === 'Cash');
  const totalCash = cashAssets.reduce((s, a) => s + a.value, 0);
  const monthlyExpenses = bills.reduce((s, b) => s + b.amount, 0);
  const emergencyMonths = monthlyExpenses > 0 ? totalCash / monthlyExpenses : 0;

  const handleSave = () => {
    if (!form.name || form.value < 0) return;
    addAsset({ name: form.name, type: 'Cash', value: Number(form.value) });
    setForm({ ...EMPTY });
    setShowForm(false);
  };

  const efStatus = emergencyMonths >= 6 ? 'strong' : emergencyMonths >= 3 ? 'ok' : 'low';
  const efColors = { strong: 'text-primary', ok: 'text-amber-600 dark:text-amber-400', low: 'text-destructive' };
  const efMessages = {
    strong: `${emergencyMonths.toFixed(1)} months — excellent coverage.`,
    ok: `${emergencyMonths.toFixed(1)} months — consider building toward 6.`,
    low: `${emergencyMonths.toFixed(1)} months — priority: build to 3 months of expenses.`,
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Banking</h1>
          <p className="text-muted-foreground mt-1 text-sm">Cash accounts and emergency fund tracking.</p>
        </div>
        <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4 mr-1" /> Add Account
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground font-medium">Total Liquid Cash</div>
            <div className="text-2xl font-bold text-foreground mt-1">{money(totalCash)}</div>
          </CardContent>
        </Card>
        <Card className="border-border shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground font-medium">Emergency Fund</div>
            <div className={`text-2xl font-bold mt-1 ${efColors[efStatus]}`}>{emergencyMonths.toFixed(1)} mo</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {monthlyExpenses > 0 ? `Based on ${money(monthlyExpenses)}/mo bills` : 'Add bills to calculate'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Emergency Fund Guidance */}
      <Card className={`border-border shadow-sm ${efStatus === 'low' ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800' : efStatus === 'ok' ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' : 'bg-accent border-primary/20'}`}>
        <CardContent className="p-4 flex gap-3">
          <Shield className={`w-5 h-5 flex-shrink-0 mt-0.5 ${efColors[efStatus]}`} />
          <div>
            <div className="font-semibold text-foreground text-sm">Emergency Fund Coverage</div>
            <div className={`text-sm mt-0.5 ${efColors[efStatus]}`}>{efMessages[efStatus]}</div>
          </div>
        </CardContent>
      </Card>

      {/* Add Form */}
      {showForm && (
        <Card className="border-primary/30 shadow-md">
          <CardHeader className="pb-3"><CardTitle className="text-base">Add Cash Account</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Account Name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Checking, Savings…" className="h-12" />
              </div>
              <div className="space-y-1">
                <Label>Balance ($)</Label>
                <Input type="number" min="0" value={form.value || ''} onChange={e => setForm(f => ({ ...f, value: Number(e.target.value) }))} className="h-12" placeholder="0" />
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 h-12" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1 h-12 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleSave}>Save</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Accounts List */}
      {cashAssets.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Landmark className="w-14 h-14 mx-auto mb-4 opacity-30" />
          <p className="font-medium">No cash accounts added.</p>
          <p className="text-sm mt-1">Add your checking, savings, or credit union accounts.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {cashAssets.map(asset => (
            <Card key={asset.id} className="border-border shadow-sm">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                  <Landmark className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-foreground">{asset.name}</div>
                  <div className="text-sm text-muted-foreground">Cash account</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-xl font-bold text-foreground">{money(asset.value)}</div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeAsset(asset.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          <div className="flex justify-between items-center px-1 pt-2 text-sm font-semibold">
            <span className="text-muted-foreground">Total</span>
            <span className="text-foreground text-base">{money(totalCash)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
