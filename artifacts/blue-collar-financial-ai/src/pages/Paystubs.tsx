import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { Plus, Trash2, FileText, DollarSign, Clock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore, Paystub } from '@/lib/store';

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

const EMPTY_FORM = {
  employer: '',
  date: new Date().toISOString().split('T')[0],
  regularHours: 40,
  overtimeHours: 0,
  doubleTimeHours: 0,
  perDiem: 0,
  grossPay: 0,
  taxes: 0,
  deductions: 0,
  netPay: 0,
};

export default function Paystubs() {
  const [_, setLocation] = useLocation();
  const { paystubs, profile, addPaystub, removePaystub } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const rate = profile?.hourlyRate ?? 0;

  const recalculate = (f: typeof form) => {
    const reg = f.regularHours * rate;
    const ot = f.overtimeHours * rate * 1.5;
    const dt = f.doubleTimeHours * rate * 2;
    const gross = reg + ot + dt + f.perDiem;
    const taxRate = profile?.filingContext === 'Married' ? 0.18 : 0.22;
    const taxes = Math.round(gross * taxRate);
    const net = gross - taxes - f.deductions;
    return { gross: Math.round(gross), taxes, net: Math.round(net) };
  };

  const handleChange = (field: string, value: string | number) => {
    const next = { ...form, [field]: typeof value === 'string' ? Number(value) || value : value };
    const calc = recalculate(next as typeof form);
    setForm({ ...next, grossPay: calc.gross, taxes: calc.taxes, netPay: calc.net } as typeof form);
  };

  const handleSave = () => {
    addPaystub({
      employer: form.employer || 'Unknown',
      date: form.date ? new Date(form.date).toISOString() : new Date().toISOString(),
      regularHours: Number(form.regularHours),
      overtimeHours: Number(form.overtimeHours),
      doubleTimeHours: Number(form.doubleTimeHours),
      perDiem: Number(form.perDiem),
      grossPay: Number(form.grossPay),
      taxes: Number(form.taxes),
      deductions: Number(form.deductions),
      netPay: Number(form.netPay),
    });
    setForm({ ...EMPTY_FORM });
    setShowForm(false);
  };

  const weeklyBase = rate * 40;
  const monthlyEstimate = weeklyBase * 4.33;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Paystubs</h1>
          <p className="text-muted-foreground mt-1 text-sm">Track your pay history and earnings breakdown.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setLocation('/documents')}>
            Scan Doc
          </Button>
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>
      </div>

      {/* Pay Summary */}
      {profile && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Base Rate', value: money(rate) + '/hr' },
            { label: 'OT Rate (1.5x)', value: money(rate * 1.5) + '/hr' },
            { label: 'DT Rate (2x)', value: money(rate * 2) + '/hr' },
            { label: 'Est. Monthly', value: money(monthlyEstimate) },
          ].map(item => (
            <Card key={item.label} className="border-border shadow-sm">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground font-medium">{item.label}</div>
                <div className="text-lg font-bold text-foreground mt-1">{item.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Form */}
      {showForm && (
        <Card className="border-primary/30 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">New Paystub Entry</CardTitle>
            <p className="text-xs text-muted-foreground">All calculations use your profile rate of {money(rate)}/hr</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Employer</Label>
                <Input
                  value={form.employer}
                  onChange={e => setForm(f => ({ ...f, employer: e.target.value }))}
                  placeholder="Company name"
                  className="h-12"
                />
              </div>
              <div className="space-y-1">
                <Label>Pay Date</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="h-12"
                />
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" /> Hours
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label>Regular</Label>
                  <Input type="number" min="0" value={form.regularHours} onChange={e => handleChange('regularHours', e.target.value)} className="h-12" />
                </div>
                <div className="space-y-1">
                  <Label>Overtime (1.5x)</Label>
                  <Input type="number" min="0" value={form.overtimeHours} onChange={e => handleChange('overtimeHours', e.target.value)} className="h-12" />
                </div>
                <div className="space-y-1">
                  <Label>Double Time (2x)</Label>
                  <Input type="number" min="0" value={form.doubleTimeHours} onChange={e => handleChange('doubleTimeHours', e.target.value)} className="h-12" />
                </div>
                <div className="space-y-1">
                  <Label>Per Diem ($)</Label>
                  <Input type="number" min="0" value={form.perDiem} onChange={e => handleChange('perDiem', e.target.value)} className="h-12" />
                </div>
              </div>
            </div>

            <div className="bg-accent rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <Label>Gross Pay</Label>
                <Input type="number" value={form.grossPay} onChange={e => setForm(f => ({ ...f, grossPay: Number(e.target.value) }))} className="h-12" />
              </div>
              <div className="space-y-1">
                <Label>Taxes</Label>
                <Input type="number" value={form.taxes} onChange={e => setForm(f => ({ ...f, taxes: Number(e.target.value) }))} className="h-12" />
              </div>
              <div className="space-y-1">
                <Label>Deductions</Label>
                <Input type="number" value={form.deductions} onChange={e => setForm(f => ({ ...f, deductions: Number(e.target.value) }))} className="h-12" />
              </div>
              <div className="space-y-1">
                <Label className="text-primary font-bold">Net Pay</Label>
                <Input type="number" value={form.netPay} onChange={e => setForm(f => ({ ...f, netPay: Number(e.target.value) }))} className="h-12 border-primary font-bold" />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 h-12" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1 h-12 bg-primary hover:bg-primary/90 text-primary-foreground text-base font-semibold" onClick={handleSave}>
                Save Paystub
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* History */}
      {paystubs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="w-14 h-14 mx-auto mb-4 opacity-30" />
          <p className="font-medium">No paystubs recorded yet.</p>
          <p className="text-sm mt-1">Add one manually or scan a document.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="font-semibold text-foreground text-sm">History ({paystubs.length})</h3>
          {paystubs.map(stub => (
            <Card key={stub.id} className="border-border shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-semibold text-foreground">{stub.employer}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{new Date(stub.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                    <div className="flex flex-wrap gap-3 mt-3 text-sm">
                      <span className="text-muted-foreground">{stub.regularHours}h reg</span>
                      {stub.overtimeHours > 0 && <span className="text-amber-600 dark:text-amber-400 font-medium">{stub.overtimeHours}h OT</span>}
                      {stub.doubleTimeHours > 0 && <span className="text-orange-600 dark:text-orange-400 font-medium">{stub.doubleTimeHours}h DT</span>}
                      {stub.perDiem > 0 && <span className="text-blue-600 dark:text-blue-400">{money(stub.perDiem)} per diem</span>}
                    </div>
                  </div>
                  <div className="text-right ml-4 flex flex-col items-end gap-2">
                    <div className="text-xl font-bold text-primary">{money(stub.netPay)}</div>
                    <div className="text-xs text-muted-foreground">Gross: {money(stub.grossPay)}</div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removePaystub(stub.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
