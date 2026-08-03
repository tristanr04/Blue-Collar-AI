import React, { useState } from 'react';
import { Plus, Trash2, CreditCard, CheckCircle2, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useStore } from '@/lib/store';

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

const EMPTY = { name: '', amount: 0, dueDate: 1, isAutoPay: false };

export default function Bills() {
  const { bills, addBill, removeBill } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const totalMonthly = bills.reduce((s, b) => s + b.amount, 0);
  const autoPayTotal = bills.filter(b => b.isAutoPay).reduce((s, b) => s + b.amount, 0);

  const handleSave = () => {
    if (!form.name || form.amount <= 0) return;
    addBill({ name: form.name, amount: Number(form.amount), dueDate: Number(form.dueDate), isAutoPay: form.isAutoPay });
    setForm({ ...EMPTY });
    setShowForm(false);
  };

  const today = new Date().getDate();
  const sorted = [...bills].sort((a, b) => {
    const aDue = a.dueDate >= today ? a.dueDate : a.dueDate + 31;
    const bDue = b.dueDate >= today ? b.dueDate : b.dueDate + 31;
    return aDue - bDue;
  });

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Bills</h1>
          <p className="text-muted-foreground mt-1 text-sm">Monthly recurring expenses and due dates.</p>
        </div>
        <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4 mr-1" /> Add Bill
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground font-medium">Total Monthly Bills</div>
            <div className="text-2xl font-bold text-foreground mt-1">{money(totalMonthly)}</div>
          </CardContent>
        </Card>
        <Card className="border-border shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground font-medium">On AutoPay</div>
            <div className="text-2xl font-bold text-primary mt-1">{money(autoPayTotal)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{bills.filter(b => b.isAutoPay).length} of {bills.length} bills</div>
          </CardContent>
        </Card>
      </div>

      {/* Add Form */}
      {showForm && (
        <Card className="border-primary/30 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Add Bill</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1 col-span-2 md:col-span-1">
                <Label>Bill Name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Rent, Phone, Insurance…" className="h-12" />
              </div>
              <div className="space-y-1">
                <Label>Amount ($)</Label>
                <Input type="number" min="0" step="0.01" value={form.amount || ''} onChange={e => setForm(f => ({ ...f, amount: Number(e.target.value) }))} className="h-12" placeholder="0.00" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Day Due (1–31)</Label>
                <Input type="number" min="1" max="31" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: Number(e.target.value) }))} className="h-12" />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch checked={form.isAutoPay} onCheckedChange={v => setForm(f => ({ ...f, isAutoPay: v }))} />
                <Label>AutoPay</Label>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 h-12" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1 h-12 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleSave}>Save</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bills List */}
      {bills.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CreditCard className="w-14 h-14 mx-auto mb-4 opacity-30" />
          <p className="font-medium">No bills added yet.</p>
          <p className="text-sm mt-1">Add your monthly expenses to track free cash flow.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map(bill => {
            const isUpcoming = bill.dueDate >= today && bill.dueDate <= today + 7;
            return (
              <Card key={bill.id} className={`border-border shadow-sm ${isUpcoming ? 'border-amber-300 dark:border-amber-700' : ''}`}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-foreground flex items-center gap-2">
                      {bill.name}
                      {bill.isAutoPay && (
                        <span className="text-xs font-medium text-primary bg-accent px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Auto
                        </span>
                      )}
                      {isUpcoming && (
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">Due soon</span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">Due: {bill.dueDate <= 9 ? `${bill.dueDate}th` : bill.dueDate === 1 ? '1st' : `${bill.dueDate}th`} of each month</div>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <div className="text-lg font-bold text-foreground">{money(bill.amount)}</div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeBill(bill.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          <div className="flex justify-between items-center px-1 pt-2 text-sm font-semibold">
            <span className="text-muted-foreground">Monthly Total</span>
            <span className="text-foreground text-base">{money(totalMonthly)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
