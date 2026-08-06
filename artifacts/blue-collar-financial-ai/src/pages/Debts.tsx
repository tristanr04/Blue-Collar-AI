import React, { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import {
  Plus, Trash2, TrendingDown, AlertCircle, Calculator, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/lib/store';
import {
  calculatePayoff,
  createPayoffPlan,
  listPayoffPlans,
  archivePayoffPlan,
  type PayoffStrategy,
  type PayoffSchedule,
  type DebtPayoffPlan,
} from '@/lib/debt-payoff-api';

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

const EMPTY = { name: '', balance: 0, interestRate: 0, minimumPayment: 0 };

const STRATEGIES: { value: PayoffStrategy; label: string; desc: string }[] = [
  { value: 'avalanche', label: 'Avalanche', desc: 'Highest interest first — saves the most money' },
  { value: 'snowball', label: 'Snowball', desc: 'Lowest balance first — fastest psychological wins' },
  { value: 'utilization', label: 'Utilization', desc: 'Highest utilisation first — boosts credit score fastest' },
  { value: 'custom', label: 'Custom', desc: 'Your own priority order' },
];

export default function Debts() {
  const { getToken } = useAuth();
  const { debts, paystubs, addDebt, removeDebt } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  // Payoff planner
  const [activeTab, setActiveTab] = useState<'tracking' | 'planner'>('tracking');
  const [strategy, setStrategy] = useState<PayoffStrategy>('avalanche');
  const [extraPayment, setExtraPayment] = useState(0);
  const [schedule, setSchedule] = useState<PayoffSchedule | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  // Saved plans
  const [savedPlans, setSavedPlans] = useState<DebtPayoffPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [planName, setPlanName] = useState('');
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);

  const totalDebt = debts.reduce((s, d) => s + d.balance, 0);
  const totalMinPayments = debts.reduce((s, d) => s + d.minimumPayment, 0);
  const monthlyIncome = paystubs.reduce((s, p) => s + p.netPay, 0);
  const debtToIncome = monthlyIncome > 0 ? (totalMinPayments / monthlyIncome) * 100 : 0;
  const highestAPR = debts.length > 0 ? [...debts].sort((a, b) => b.interestRate - a.interestRate)[0] : null;

  const handleSave = () => {
    if (!form.name || form.balance <= 0) return;
    addDebt({ name: form.name, balance: Number(form.balance), interestRate: Number(form.interestRate), minimumPayment: Number(form.minimumPayment) });
    setForm({ ...EMPTY });
    setShowForm(false);
  };

  const loadPlans = async () => {
    try {
      setPlansLoading(true);
      const token = await getToken();
      if (!token) return;
      const plans = await listPayoffPlans(token);
      setSavedPlans(plans);
    } catch {
      // silently fail
    } finally {
      setPlansLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'planner') loadPlans();
  }, [activeTab]);

  const handleCalculate = async () => {
    if (debts.length === 0) { setCalcError('Add some debts first.'); return; }
    setCalcError(null);
    try {
      setCalculating(true);
      const token = await getToken();
      if (!token) return;
      const result = await calculatePayoff(token, strategy, extraPayment);
      setSchedule(result);
    } catch (e: any) {
      setCalcError(e.message ?? 'Calculation failed. Are you signed in?');
    } finally {
      setCalculating(false);
    }
  };

  const handleSavePlan = async () => {
    if (!planName.trim() || !schedule) return;
    try {
      setSavingPlan(true);
      const token = await getToken();
      if (!token) return;
      const plan = await createPayoffPlan(token, { name: planName.trim(), strategy, extraMonthlyPayment: extraPayment });
      setSavedPlans((prev) => [...prev, plan]);
      setPlanName('');
    } catch (e: any) {
      setCalcError(e.message ?? 'Failed to save plan.');
    } finally {
      setSavingPlan(false);
    }
  };

  const handleDeletePlan = async (id: string) => {
    try {
      const token = await getToken();
      if (!token) return;
      await archivePayoffPlan(token, id);
      setSavedPlans((prev) => prev.filter((p) => p.id !== id));
    } catch {}
  };

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

      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab('tracking')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'tracking' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Tracking
        </button>
        <button
          onClick={() => setActiveTab('planner')}
          className={`flex items-center gap-1 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'planner' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Calculator className="w-3.5 h-3.5" /> Payoff Planner
        </button>
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
            <div className="text-sm text-amber-700 dark:text-amber-300 mt-0.5">{highestAPR.interestRate}% APR — paying this off first saves the most money.</div>
          </div>
        </div>
      )}

      {/* ── TRACKING TAB ── */}
      {activeTab === 'tracking' && (
        <>
          {showForm && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label>Name</Label>
                    <Input placeholder="Credit card, auto loan…" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Balance ($)</Label>
                    <Input type="number" min={0} placeholder="12000" value={form.balance || ''} onChange={(e) => setForm({ ...form, balance: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-1">
                    <Label>APR (%)</Label>
                    <Input type="number" min={0} max={100} step={0.01} placeholder="19.99" value={form.interestRate || ''} onChange={(e) => setForm({ ...form, interestRate: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Min Payment ($/mo)</Label>
                    <Input type="number" min={0} placeholder="250" value={form.minimumPayment || ''} onChange={(e) => setForm({ ...form, minimumPayment: parseFloat(e.target.value) || 0 })} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleSave} disabled={!form.name || form.balance <= 0}>Save</Button>
                  <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}

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
        </>
      )}

      {/* ── PLANNER TAB ── */}
      {activeTab === 'planner' && (
        <div className="space-y-5">
          {debts.length === 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-700 dark:text-amber-300">
              Add debts in the Tracking tab first, then come back to run the payoff calculator.
            </div>
          )}

          {/* Strategy picker */}
          <Card className="border-border">
            <CardHeader><CardTitle className="text-base">Configure Strategy</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {STRATEGIES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setStrategy(s.value)}
                    className={`text-left p-3 rounded-xl border transition-colors ${strategy === s.value ? 'border-primary bg-primary/10 text-foreground' : 'border-border hover:bg-white/5 text-muted-foreground'}`}
                  >
                    <div className={`font-semibold text-sm ${strategy === s.value ? 'text-foreground' : ''}`}>{s.label}</div>
                    <div className="text-xs mt-0.5">{s.desc}</div>
                  </button>
                ))}
              </div>

              <div className="flex items-end gap-3">
                <div className="flex-1 space-y-1">
                  <Label>Extra monthly payment ($)</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={extraPayment || ''}
                    onChange={(e) => setExtraPayment(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <Button
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  onClick={handleCalculate}
                  disabled={calculating || debts.length === 0}
                >
                  {calculating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Calculator className="w-4 h-4 mr-1" />}
                  {calculating ? 'Calculating…' : 'Calculate'}
                </Button>
              </div>

              {calcError && (
                <p className="text-sm text-destructive">{calcError}</p>
              )}
            </CardContent>
          </Card>

          {/* Schedule results */}
          {schedule && (
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader><CardTitle className="text-base">Payoff Summary — {strategy.charAt(0).toUpperCase() + strategy.slice(1)}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-foreground">{schedule.totalMonths}</div>
                    <div className="text-xs text-muted-foreground">months</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-destructive">{money(schedule.totalInterestPaid)}</div>
                    <div className="text-xs text-muted-foreground">total interest</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-foreground">{money(schedule.totalPaid)}</div>
                    <div className="text-xs text-muted-foreground">total paid</div>
                  </div>
                </div>

                {schedule.truncated && (
                  <p className="text-xs text-muted-foreground">
                    ⚠ Schedule exceeds 30 years — some debts may not be paid off with minimum payments alone.
                  </p>
                )}

                {/* Per-debt payoff order */}
                <div className="space-y-2">
                  {schedule.debtSummaries.map((s, i) => (
                    <div key={s.debtId} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-muted-foreground w-5">#{i + 1}</span>
                        <span className="font-medium text-foreground">{s.name}</span>
                      </div>
                      <div className="flex gap-4 text-right text-xs text-muted-foreground">
                        <span>{money(s.totalInterestPaid)} interest</span>
                        <span className="font-semibold text-foreground">Month {s.payoffMonth}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Save plan */}
                <div className="border-t border-border pt-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Plan name (e.g. 'My Avalanche Plan')"
                      className="h-8 text-sm flex-1"
                      value={planName}
                      onChange={(e) => setPlanName(e.target.value)}
                    />
                    <Button
                      size="sm"
                      className="h-8 bg-primary hover:bg-primary/90 text-primary-foreground"
                      onClick={handleSavePlan}
                      disabled={savingPlan || !planName.trim()}
                    >
                      {savingPlan ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save Plan'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Saved plans */}
          {savedPlans.length > 0 && (
            <div>
              <h3 className="font-semibold text-foreground mb-3">Saved Plans</h3>
              <div className="space-y-2">
                {savedPlans.map((plan) => (
                  <Card key={plan.id} className="border-border">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium text-sm text-foreground">{plan.name}</span>
                          <span className="ml-2 text-xs text-muted-foreground capitalize">{plan.strategy}</span>
                          {plan.extraMonthlyPayment > 0 && (
                            <span className="ml-2 text-xs text-muted-foreground">+{money(plan.extraMonthlyPayment)}/mo</span>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => {
                              setStrategy(plan.strategy);
                              setExtraPayment(plan.extraMonthlyPayment);
                              handleCalculate();
                            }}
                          >
                            Load
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() => handleDeletePlan(plan.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
