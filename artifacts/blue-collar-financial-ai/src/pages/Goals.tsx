import React, { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import {
  Target, Plus, Trash2, ChevronDown, ChevronUp, ShieldCheck, TrendingUp, Briefcase,
  Home, Car, Star, CheckCircle2, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  listGoals,
  createGoal,
  updateGoal,
  contributeToGoal,
  archiveGoal,
  type Goal,
  type CreateGoalInput,
} from '@/lib/goals-api';

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

const pct = (current: number, target: number) =>
  target > 0 ? Math.min(100, (current / target) * 100) : 0;

const CATEGORY_META: Record<Goal['category'], { label: string; Icon: React.ElementType; color: string }> = {
  emergency_fund: { label: 'Emergency Fund', Icon: ShieldCheck, color: 'text-emerald-400' },
  savings: { label: 'Savings', Icon: TrendingUp, color: 'text-blue-400' },
  debt_payoff: { label: 'Debt Payoff', Icon: Briefcase, color: 'text-orange-400' },
  investment: { label: 'Investment', Icon: Star, color: 'text-purple-400' },
  purchase: { label: 'Purchase', Icon: Car, color: 'text-pink-400' },
  other: { label: 'Other', Icon: Home, color: 'text-slate-400' },
};

const CATEGORIES = Object.entries(CATEGORY_META) as [
  Goal['category'],
  { label: string; Icon: React.ElementType; color: string },
][];

const EMPTY_FORM: CreateGoalInput = {
  title: '',
  category: 'savings',
  targetAmount: 0,
  currentAmount: 0,
  targetDate: '',
  description: '',
};

export default function Goals() {
  const { getToken } = useAuth();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [contributeId, setContributeId] = useState<string | null>(null);
  const [contributeAmount, setContributeAmount] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      const gs = await listGoals(token);
      setGoals(gs);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load goals.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.title || form.targetAmount <= 0) return;
    try {
      setSaving(true);
      const token = await getToken();
      if (!token) return;
      const goal = await createGoal(token, {
        ...form,
        targetDate: form.targetDate || undefined,
        description: form.description || undefined,
      });
      setGoals((prev) => [...prev, goal]);
      setForm({ ...EMPTY_FORM });
      setShowForm(false);
    } catch (e: any) {
      setError(e.message ?? 'Failed to create goal.');
    } finally {
      setSaving(false);
    }
  };

  const handleContribute = async (goalId: string) => {
    const amt = parseFloat(contributeAmount);
    if (isNaN(amt)) return;
    try {
      const token = await getToken();
      if (!token) return;
      const updated = await contributeToGoal(token, goalId, amt);
      setGoals((prev) => prev.map((g) => (g.id === goalId ? updated : g)));
      setContributeId(null);
      setContributeAmount('');
    } catch (e: any) {
      setError(e.message ?? 'Failed to update contribution.');
    }
  };

  const handleArchive = async (goalId: string) => {
    try {
      const token = await getToken();
      if (!token) return;
      await archiveGoal(token, goalId);
      setGoals((prev) => prev.filter((g) => g.id !== goalId));
    } catch (e: any) {
      setError(e.message ?? 'Failed to archive goal.');
    }
  };

  const handleStatusToggle = async (goal: Goal) => {
    const newStatus = goal.status === 'paused' ? 'active' : 'paused';
    try {
      const token = await getToken();
      if (!token) return;
      const updated = await updateGoal(token, goal.id, { status: newStatus });
      setGoals((prev) => prev.map((g) => (g.id === goal.id ? updated : g)));
    } catch {}
  };

  const activeGoals = goals.filter((g) => g.status !== 'archived');
  const totalTargeted = activeGoals.reduce((s, g) => s + g.targetAmount, 0);
  const totalSaved = activeGoals.reduce((s, g) => s + g.currentAmount, 0);
  const completedCount = activeGoals.filter((g) => g.status === 'completed').length;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Financial Goals</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Set targets, track progress, and hit milestones.
          </p>
        </div>
        <Button
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
          onClick={() => setShowForm(true)}
        >
          <Plus className="w-4 h-4 mr-1" /> New Goal
        </Button>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Goals', value: activeGoals.length.toString() },
          { label: 'Completed', value: completedCount.toString() },
          { label: 'Total Saved', value: money(totalSaved) },
        ].map((s) => (
          <Card key={s.label} className="border-border shadow-sm">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground font-medium">{s.label}</div>
              <div className="text-xl font-bold text-foreground mt-1">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 text-sm text-destructive">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base">New Goal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Title *</Label>
                <Input
                  placeholder="Emergency fund, new truck…"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Category</Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as Goal['category'] })}
                >
                  {CATEGORIES.map(([cat, meta]) => (
                    <option key={cat} value={cat}>{meta.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Target Amount *</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="5000"
                  value={form.targetAmount || ''}
                  onChange={(e) => setForm({ ...form, targetAmount: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-1">
                <Label>Current Amount</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={form.currentAmount || ''}
                  onChange={(e) => setForm({ ...form, currentAmount: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-1">
                <Label>Target Date (optional)</Label>
                <Input
                  type="date"
                  value={form.targetDate}
                  onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Description (optional)</Label>
                <Input
                  placeholder="Why this goal matters…"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={handleCreate}
                disabled={saving || !form.title || form.targetAmount <= 0}
              >
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                {saving ? 'Saving…' : 'Create Goal'}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Goal list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : activeGoals.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Target className="w-14 h-14 mx-auto mb-4 opacity-30" />
          <p className="font-medium">No goals yet.</p>
          <p className="text-sm mt-1">Create your first goal to start tracking progress.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeGoals.map((goal) => {
            const meta = CATEGORY_META[goal.category] ?? CATEGORY_META.other;
            const Icon = meta.Icon;
            const progress = pct(goal.currentAmount, goal.targetAmount);
            const isExpanded = expandedId === goal.id;
            const isContributing = contributeId === goal.id;

            return (
              <Card
                key={goal.id}
                className={`border-border shadow-sm ${goal.status === 'completed' ? 'opacity-80' : ''}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`p-2 rounded-lg bg-white/5 flex-shrink-0`}>
                        <Icon className={`w-5 h-5 ${meta.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-foreground truncate">{goal.title}</span>
                          {goal.status === 'completed' && (
                            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Done
                            </Badge>
                          )}
                          {goal.status === 'paused' && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">Paused</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{meta.label}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-sm font-bold text-foreground">{money(goal.currentAmount)}</span>
                      <span className="text-xs text-muted-foreground">/ {money(goal.targetAmount)}</span>
                      <button
                        className="ml-2 text-muted-foreground hover:text-foreground"
                        onClick={() => setExpandedId(isExpanded ? null : goal.id)}
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3">
                    <Progress value={progress} className="h-2" />
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                      <span>{progress.toFixed(0)}% complete</span>
                      {goal.targetDate && <span>Target: {goal.targetDate}</span>}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 space-y-3 border-t border-border pt-3">
                      {goal.description && (
                        <p className="text-sm text-muted-foreground">{goal.description}</p>
                      )}

                      {/* Contribute */}
                      {goal.status !== 'completed' && (
                        <div>
                          {isContributing ? (
                            <div className="flex gap-2">
                              <Input
                                type="number"
                                placeholder="Amount (positive or negative)"
                                className="h-8 text-sm"
                                value={contributeAmount}
                                onChange={(e) => setContributeAmount(e.target.value)}
                              />
                              <Button
                                size="sm"
                                className="bg-primary hover:bg-primary/90 text-primary-foreground h-8"
                                onClick={() => handleContribute(goal.id)}
                              >
                                Apply
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8"
                                onClick={() => { setContributeId(null); setContributeAmount(''); }}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="flex gap-2 flex-wrap">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs"
                                onClick={() => { setContributeId(goal.id); setContributeAmount(''); }}
                              >
                                Update Progress
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs"
                                onClick={() => handleStatusToggle(goal)}
                              >
                                {goal.status === 'paused' ? 'Resume' : 'Pause'}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 text-xs text-destructive hover:text-destructive"
                                onClick={() => handleArchive(goal.id)}
                              >
                                <Trash2 className="w-3 h-3 mr-1" /> Archive
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
