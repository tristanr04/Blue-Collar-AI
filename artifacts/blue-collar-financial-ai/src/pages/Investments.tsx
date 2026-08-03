import React, { useState } from 'react';
import { Plus, Trash2, PieChart, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useStore } from '@/lib/store';

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

const EMPTY = { name: '', type: 'Investment' as 'Investment' | 'Other', value: 0 };

export default function Investments() {
  const { assets, debts, addAsset, removeAsset } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const investmentAssets = assets.filter(a => a.type === 'Investment' || a.type === 'Other');
  const cashAssets = assets.filter(a => a.type === 'Cash');
  const totalInvested = investmentAssets.reduce((s, a) => s + a.value, 0);
  const totalCash = cashAssets.reduce((s, a) => s + a.value, 0);
  const totalAssets = assets.reduce((s, a) => s + a.value, 0);
  const totalDebt = debts.reduce((s, d) => s + d.balance, 0);
  const netWorth = totalAssets - totalDebt;

  const handleSave = () => {
    if (!form.name || form.value < 0) return;
    addAsset({ name: form.name, type: form.type, value: Number(form.value) });
    setForm({ ...EMPTY });
    setShowForm(false);
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Investments</h1>
          <p className="text-muted-foreground mt-1 text-sm">Retirement accounts, brokerage, and other assets.</p>
        </div>
        <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4 mr-1" /> Add Asset
        </Button>
      </div>

      {/* Net Worth Summary */}
      <Card className="bg-secondary text-secondary-foreground border-0 shadow-md">
        <CardContent className="p-6">
          <div className="text-sm font-medium opacity-70 mb-1">Total Net Worth</div>
          <div className={`text-4xl font-bold ${netWorth >= 0 ? 'text-white' : 'text-red-300'}`}>{money(netWorth)}</div>
          <div className="flex gap-6 mt-4 text-sm opacity-80">
            <div><div className="font-medium">Assets</div><div className="text-lg font-bold text-white">{money(totalAssets)}</div></div>
            <div><div className="font-medium">Debts</div><div className="text-lg font-bold text-red-300">{money(totalDebt)}</div></div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground font-medium">Invested</div>
            <div className="text-2xl font-bold text-primary mt-1">{money(totalInvested)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">401k, IRA, brokerage</div>
          </CardContent>
        </Card>
        <Card className="border-border shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground font-medium">Liquid Cash</div>
            <div className="text-2xl font-bold text-foreground mt-1">{money(totalCash)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Checking, savings</div>
          </CardContent>
        </Card>
      </div>

      {/* Add Form */}
      {showForm && (
        <Card className="border-primary/30 shadow-md">
          <CardHeader className="pb-3"><CardTitle className="text-base">Add Investment or Asset</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Union 401k, Brokerage…" className="h-12" />
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as 'Investment' | 'Other' }))}>
                  <SelectTrigger className="h-12"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Investment">Investment</SelectItem>
                    <SelectItem value="Other">Other Asset</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Current Value ($)</Label>
              <Input type="number" min="0" value={form.value || ''} onChange={e => setForm(f => ({ ...f, value: Number(e.target.value) }))} className="h-12" placeholder="0" />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 h-12" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1 h-12 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleSave}>Save</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Investment List */}
      {investmentAssets.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <PieChart className="w-14 h-14 mx-auto mb-4 opacity-30" />
          <p className="font-medium">No investments added yet.</p>
          <p className="text-sm mt-1">Add your 401k, IRA, or brokerage accounts.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {investmentAssets.map(asset => (
            <Card key={asset.id} className="border-border shadow-sm">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-foreground">{asset.name}</div>
                  <div className="text-sm text-muted-foreground">{asset.type}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-xl font-bold text-primary">{money(asset.value)}</div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeAsset(asset.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          <div className="flex justify-between items-center px-1 pt-2 text-sm font-semibold">
            <span className="text-muted-foreground">Total Invested</span>
            <span className="text-foreground text-base">{money(totalInvested)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
