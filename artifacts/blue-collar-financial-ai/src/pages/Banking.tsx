import React, { useState } from 'react';
import { Plus, Trash2, Landmark, Shield, WalletCards, ScanLine, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/lib/store';
import { useLocation } from 'wouter';

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

const EMPTY = { name: '', type: 'Cash' as 'Cash' | 'Investment' | 'Other', value: 0 };

export default function Banking() {
  const { assets, bills, addAsset, removeAsset } = useStore();
  const [_, setLocation] = useLocation();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const cashAssets = assets.filter(a => a.type === 'Cash');
  const totalCash = cashAssets.reduce((s, a) => s + a.value, 0);
  const monthlyExpenses = bills.reduce((s, b) => s + b.amount, 0);
  const emergencyMonths = monthlyExpenses > 0 ? totalCash / monthlyExpenses : 0;
  const emergencyGoal = monthlyExpenses * 6;
  const emergencyProgress = emergencyGoal > 0 ? Math.min(100, (totalCash / emergencyGoal) * 100) : 0;

  const handleSave = () => {
    if (!form.name || form.value < 0) return;
    addAsset({ name: form.name, type: 'Cash', value: Number(form.value) });
    setForm({ ...EMPTY });
    setShowForm(false);
  };

  const efStatus = emergencyMonths >= 6 ? 'Strong' : emergencyMonths >= 3 ? 'Building' : 'Priority';
  const efTone = emergencyMonths >= 6 ? 'text-emerald-400' : emergencyMonths >= 3 ? 'text-amber-400' : 'text-rose-400';

  return (
    <div className="min-h-full bg-[#07111f] text-white">
      <div className="mx-auto max-w-6xl space-y-6 p-4 pb-28 md:p-8 md:pb-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-400">Accounts</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Cash Command Center</h1>
            <p className="mt-1 text-sm text-slate-400">Checking, savings and emergency reserves in one view.</p>
          </div>
          <Button className="rounded-xl bg-sky-500 text-slate-950 hover:bg-sky-400" onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Account
          </Button>
        </div>

        <section className="overflow-hidden rounded-3xl border border-sky-400/20 bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.18),transparent_38%),linear-gradient(145deg,#0d1b2d,#08111f)] p-5 shadow-2xl shadow-sky-950/30 md:p-7">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-slate-400">Total liquid cash</div>
              <div className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">{money(totalCash)}</div>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                <WalletCards className="h-3.5 w-3.5 text-sky-400" /> {cashAssets.length} connected cash account{cashAssets.length === 1 ? '' : 's'}
              </div>
            </div>
            <div className="hidden h-20 w-20 items-center justify-center rounded-3xl border border-sky-400/20 bg-sky-400/10 md:flex">
              <Landmark className="h-9 w-9 text-sky-400" />
            </div>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Emergency coverage</span>
              <Shield className={`h-5 w-5 ${efTone}`} />
            </div>
            <div className="mt-3 text-3xl font-bold">{emergencyMonths.toFixed(1)} mo</div>
            <div className={`mt-1 text-sm font-medium ${efTone}`}>{efStatus}</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 md:col-span-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Six-month reserve goal</span>
              <span className="font-semibold text-white">{money(emergencyGoal)}</span>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all" style={{ width: `${emergencyProgress}%` }} />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>{Math.round(emergencyProgress)}% funded</span>
              <span>{monthlyExpenses > 0 ? `${money(monthlyExpenses)}/mo expenses` : 'Add bills to calculate goal'}</span>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <button onClick={() => setLocation('/scanner')} className="flex items-center justify-between rounded-2xl border border-sky-400/20 bg-sky-400/10 p-4 text-left transition hover:bg-sky-400/15">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-sky-400/15 p-2.5"><ScanLine className="h-5 w-5 text-sky-400" /></div>
              <div><div className="font-semibold">Scan a statement</div><div className="text-xs text-slate-400">Update balances automatically</div></div>
            </div>
            <ArrowUpRight className="h-4 w-4 text-sky-400" />
          </button>
          <button onClick={() => setShowForm(true)} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left transition hover:bg-white/[0.06]">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white/5 p-2.5"><Plus className="h-5 w-5 text-emerald-400" /></div>
              <div><div className="font-semibold">Add manually</div><div className="text-xs text-slate-400">Create a cash account</div></div>
            </div>
            <ArrowUpRight className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        {showForm && (
          <section className="rounded-3xl border border-sky-400/25 bg-[#0b1727] p-5 shadow-xl shadow-black/20">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Add cash account</h2>
              <p className="text-sm text-slate-400">Enter the current balance. You can update it later by scanning a statement.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-slate-300">Account name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Checking, Savings…" className="h-12 border-white/10 bg-white/5" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Balance</Label>
                <Input type="number" min="0" value={form.value || ''} onChange={e => setForm(f => ({ ...f, value: Number(e.target.value) }))} className="h-12 border-white/10 bg-white/5" placeholder="0" />
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <Button variant="outline" className="flex-1 border-white/10 bg-transparent hover:bg-white/5" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1 bg-sky-500 text-slate-950 hover:bg-sky-400" onClick={handleSave}>Save account</Button>
            </div>
          </section>
        )}

        <section>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Your accounts</h2>
              <p className="text-sm text-slate-500">Current balances across all cash accounts.</p>
            </div>
            <div className="text-sm font-semibold text-sky-400">{money(totalCash)}</div>
          </div>

          {cashAssets.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.025] px-6 py-14 text-center">
              <Landmark className="mx-auto mb-4 h-12 w-12 text-slate-600" />
              <p className="font-medium">No cash accounts yet</p>
              <p className="mt-1 text-sm text-slate-500">Scan a statement or add checking and savings manually.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {cashAssets.map((asset, index) => (
                <div key={asset.id} className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4 transition hover:border-sky-400/25 hover:bg-white/[0.055]">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-sky-400/15 bg-sky-400/10">
                    <Landmark className="h-5 w-5 text-sky-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{asset.name}</div>
                    <div className="mt-0.5 text-xs text-slate-500">Cash account · #{String(index + 1).padStart(2, '0')}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold">{money(asset.value)}</div>
                    <button className="mt-1 inline-flex items-center gap-1 text-xs text-slate-600 transition hover:text-rose-400" onClick={() => removeAsset(asset.id)}>
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
