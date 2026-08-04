import React, { useEffect } from 'react';
import { useLocation } from 'wouter';
import { Plus, ArrowRight, TrendingUp, PiggyBank, Target, UploadCloud, Sparkles, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useStore } from '@/lib/store';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AgeBenchmarkCard } from '@/components/AgeBenchmarkCard';
import { ageFromBirthDate } from '@/lib/age-benchmarks';

// ─── Financial Health Score ───────────────────────────────────────────────────

interface ScoreBreakdown {
  label: string;
  score: number;
  max: number;
  tip: string;
}

/**
 * Build the health-score breakdown.
 *
 * `monthlyGross` is the correct denominator for the debt-to-income ratio
 * (lender-standard definition: minimum debt payments ÷ gross income).
 */
function calcHealthScore(data: {
  monthlyNet: number;
  monthlyGross: number;
  totalBills: number;
  totalDebtMins: number;
  liquidCash: number;
  totalDebt: number;
  debts: { interestRate: number; balance: number }[];
  assets: { type: string; value: number }[];
  paystubCount: number;
  retirementValue: number;
}): { score: number; breakdown: ScoreBreakdown[] } {
  const { monthlyNet, monthlyGross, totalBills, totalDebtMins, liquidCash, totalDebt, debts, retirementValue, paystubCount } = data;
  const freeCash = monthlyNet - totalBills - totalDebtMins;
  const monthlyExpenses = totalBills + totalDebtMins;
  const breakdown: ScoreBreakdown[] = [];

  if (paystubCount > 0 && monthlyNet > 0) {
    // 1. Positive cash flow (20 pts)
    let cfScore = 0;
    if (freeCash > monthlyNet * 0.2) cfScore = 20;
    else if (freeCash > 0) cfScore = Math.round((freeCash / (monthlyNet * 0.2)) * 20);
    breakdown.push({ label: 'Cash Flow', score: cfScore, max: 20, tip: cfScore < 20 ? 'Aim for 20%+ of take-home as free cash.' : 'Great cash flow!' });

    // 2. Emergency fund (20 pts)
    // When expenses are 0 and cash is positive, coverage is effectively infinite.
    const emMonths = monthlyExpenses > 0 ? liquidCash / monthlyExpenses : (liquidCash > 0 ? Infinity : 0);
    let efScore = 0;
    if (emMonths >= 6) efScore = 20;
    else if (emMonths >= 3) efScore = 14;
    else if (emMonths >= 1) efScore = 7;
    const emLabel = emMonths === Infinity ? '∞' : emMonths.toFixed(1);
    breakdown.push({ label: 'Emergency Fund', score: efScore, max: 20, tip: efScore < 20 ? `You have ${emLabel} months — aim for 6.` : '6+ months saved!' });

    // 3. Credit utilization (15 pts)
    const ccDebts = debts.filter(d => d.interestRate > 10);
    const totalCcBalance = ccDebts.reduce((s, d) => s + d.balance, 0);
    if (totalCcBalance > 0) {
      const util = Math.min(totalCcBalance / 10000, 1);
      const utilScore = util < 0.3 ? 15 : util < 0.6 ? 8 : 0;
      breakdown.push({ label: 'Credit Use', score: utilScore, max: 15, tip: utilScore < 15 ? 'High-interest balances dragging your score.' : 'Low revolving debt — great!' });
    }

    // 4. Debt-to-income using GROSS income (lender-standard — same threshold as mortgage underwriting)
    const dti = monthlyGross > 0 ? totalDebtMins / monthlyGross : 0;
    let dtiScore = 0;
    if (dti <= 0.15) dtiScore = 15;
    else if (dti <= 0.28) dtiScore = 10;
    else if (dti <= 0.36) dtiScore = 5;
    breakdown.push({
      label: 'Debt-to-Income',
      score: dtiScore,
      max: 15,
      tip: dtiScore < 15
        ? `Min payments are ${Math.round(dti * 100)}% of gross income.`
        : 'Debt payments well under control.',
    });

    // 5. High-interest debt (10 pts)
    const highInt = debts.filter(d => d.interestRate > 15);
    const hiScore = highInt.length === 0 ? 10 : highInt.length === 1 ? 4 : 0;
    if (highInt.length > 0) {
      breakdown.push({ label: 'High-Interest Debt', score: hiScore, max: 10, tip: `${highInt.length} debt${highInt.length > 1 ? 's' : ''} above 15% APR — priority payoff.` });
    } else {
      breakdown.push({ label: 'High-Interest Debt', score: 10, max: 10, tip: 'No high-interest debt — excellent!' });
    }

    // 6. Retirement (10 pts)
    const retScore = retirementValue > 0 ? 10 : 0;
    breakdown.push({ label: 'Retirement', score: retScore, max: 10, tip: retScore === 0 ? 'Start contributing to a 401k or IRA.' : 'Contributing to retirement.' });
  }

  const totalMax = breakdown.reduce((s, b) => s + b.max, 0) || 100;
  const totalScore = breakdown.reduce((s, b) => s + b.score, 0);
  const score = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;

  return { score, breakdown };
}

function ScoreRing({ score }: { score: number }) {
  const r = 44;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 70 ? '#10b981' : score >= 45 ? '#f59e0b' : '#ef4444';
  const label = score >= 70 ? 'Good' : score >= 45 ? 'Fair' : 'Needs Work';

  return (
    <div className="flex flex-col items-center justify-center">
      <svg width="110" height="110" viewBox="0 0 110 110">
        <circle cx="55" cy="55" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-muted/20" />
        <circle
          cx="55" cy="55" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 55 55)"
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
        <text x="55" y="50" textAnchor="middle" className="text-2xl font-bold" fill={color} style={{ fontSize: 22, fontWeight: 700 }}>{score}</text>
        <text x="55" y="68" textAnchor="middle" fill="currentColor" style={{ fontSize: 11, opacity: 0.6 }}>{label}</text>
      </svg>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [_, setLocation] = useLocation();
  const { profile, paystubs, bills, debts, assets, computed } = useStore();

  useEffect(() => {
    if (!profile?.hasCompletedOnboarding) setLocation('/welcome');
  }, [profile, setLocation]);

  if (!profile) return null;

  // All metrics come from the store's deterministic engine (sortPaystubsNewestFirst, gross DTI).
  const {
    monthlyNet, monthlyGross, totalBills,
    totalDebtMin: totalDebtMins, freeCashFlow,
    liquidCash, totalInvestments, totalDebt, netWorth,
    emergencyMonths, retirementTotal: retirementValue,
  } = computed;

  const freq = profile.payFrequency;
  const multiplier = freq === 'Weekly' ? 4.33 : freq === 'Bi-Weekly' ? 2.17 : freq === 'Semi-Monthly' ? 2 : 1;

  const { score, breakdown } = calcHealthScore({
    monthlyNet, monthlyGross, totalBills, totalDebtMins,
    liquidCash, totalDebt, debts, assets,
    retirementValue, paystubCount: paystubs.length,
  });

  const chartData = [
    { name: 'Gross Pay', value: monthlyGross, color: '#64748b' },
    { name: 'Take Home', value: monthlyNet, color: '#10b981' },
    { name: 'Bills', value: totalBills, color: '#f59e0b' },
    { name: 'Debt Pmts', value: totalDebtMins, color: '#ef4444' },
    { name: 'Free Cash', value: Math.max(0, freeCashFlow), color: '#6366f1' },
  ];

  const fmt = (n: number) => n < 0
    ? `-$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Hey, {profile.name}</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Financial Command Center</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="bg-white dark:bg-slate-900" onClick={() => setLocation('/scanner')}>
            <UploadCloud className="w-4 h-4 mr-2" /> Scan Docs
          </Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setLocation('/ask-ai')}>
            <Sparkles className="w-4 h-4 mr-2" /> Ask AI
          </Button>
        </div>
      </div>

      {/* Top metric strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Monthly Take-Home', value: fmt(monthlyNet), sub: `${freq} × ${multiplier}`, accent: false },
          { label: 'Free Cash Flow', value: fmt(freeCashFlow), sub: 'After bills & min payments', accent: freeCashFlow > 0 },
          { label: 'Liquid Cash', value: fmt(liquidCash), sub: emergencyMonths === Infinity ? '∞ months covered (no obligations)' : `${emergencyMonths} months covered`, accent: false },
          { label: 'Net Worth', value: fmt(netWorth), sub: 'Assets minus all debts', accent: false },
        ].map((m) => (
          <Card key={m.label} className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
            <CardContent className="pt-4">
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{m.label}</div>
              <div className={`text-2xl font-bold ${m.accent ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>
                {m.value}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">{m.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Second row: Health Score + Chart */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Health Score */}
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="w-4 h-4 text-emerald-600" /> Financial Health Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            {paystubs.length === 0 ? (
              <div className="text-center py-4 text-slate-500 text-sm">
                <div className="mb-2">Add a paystub or scan documents to calculate your score.</div>
                <Button variant="link" className="text-emerald-600 p-0" onClick={() => setLocation('/scanner')}>Scan documents →</Button>
              </div>
            ) : (
              <div className="flex gap-4 items-start">
                <ScoreRing score={score} />
                <div className="flex-1 space-y-1.5">
                  {breakdown.map((b) => (
                    <div key={b.label}>
                      <div className="flex justify-between items-center text-xs mb-0.5">
                        <span className="text-slate-600 dark:text-slate-400">{b.label}</span>
                        <span className="font-medium text-slate-900 dark:text-white">{b.score}/{b.max}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${(b.score / b.max) * 100}%` }}
                        />
                      </div>
                      {b.score < b.max && (
                        <div className="text-[10px] text-slate-400 mt-0.5">{b.tip}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Monthly Cash Flow Chart */}
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="w-4 h-4 text-emerald-600" /> Monthly Cash Flow
            </CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyNet === 0 ? (
              <div className="text-center py-4 text-slate-500 text-sm">Add paystub data to see your cash flow chart.</div>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Expanded metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Debt', value: fmt(totalDebt), warn: totalDebt > monthlyNet * 6 },
          { label: 'Investments', value: fmt(totalInvestments), warn: false },
          { label: 'Monthly Bills', value: fmt(totalBills), warn: false },
          { label: 'Emergency Fund', value: emergencyMonths === Infinity ? '∞ mo' : `${emergencyMonths} mo`, warn: emergencyMonths !== Infinity && emergencyMonths < 3 },
        ].map(m => (
          <div key={m.label} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-sm">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
              {m.warn && <AlertTriangle className="w-3 h-3 text-amber-500" />}
              {m.label}
            </div>
            <div className="text-xl font-bold text-slate-900 dark:text-white">{m.value}</div>
          </div>
        ))}
      </div>

      {/* Age Benchmark */}
      <AgeBenchmarkCard
        age={profile.birthDate ? ageFromBirthDate(profile.birthDate) : null}
        annualGrossIncome={monthlyGross > 0 ? monthlyGross * 12 : null}
        netWorth={netWorth}
      />

      {/* Recent paystubs + next moves */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-emerald-600" />
              Recommended Next Moves
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4">
              {breakdown.filter(b => b.score < b.max).slice(0, 3).map((b, i) => (
                <li key={b.label} className="flex gap-3 items-start">
                  <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-700 dark:text-amber-400 text-xs font-bold flex-shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100 text-sm">{b.label}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{b.tip}</div>
                  </div>
                </li>
              ))}
              {breakdown.filter(b => b.score < b.max).length === 0 && paystubs.length > 0 && (
                <li className="text-sm text-slate-500 dark:text-slate-400">
                  Your finances are in great shape! Keep it up.
                </li>
              )}
              {paystubs.length === 0 && (
                <>
                  {[
                    { label: 'Scan your paystub', tip: 'Get accurate take-home estimates and health score.' },
                    { label: 'Add remaining debts', tip: 'See your full debt picture and payoff timeline.' },
                    { label: 'Run an overtime scenario', tip: 'See how extra shifts impact debt payoff.' },
                  ].map((m, i) => (
                    <li key={m.label} className="flex gap-3 items-start">
                      <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400 text-xs font-bold flex-shrink-0 mt-0.5">
                        {i + 1}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100 text-sm">{m.label}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{m.tip}</div>
                      </div>
                    </li>
                  ))}
                </>
              )}
            </ul>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader>
            <CardTitle>Recent Paystubs</CardTitle>
          </CardHeader>
          <CardContent>
            {paystubs.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <PiggyBank className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-700 mb-3" />
                <p className="text-sm">No paystubs yet.</p>
                <Button variant="link" className="text-emerald-600 text-sm" onClick={() => setLocation('/scanner')}>Scan one now →</Button>
              </div>
            ) : (
              <div className="space-y-3">
                {paystubs.slice(0, 4).map(stub => (
                  <div key={stub.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                    <div>
                      <div className="font-medium text-slate-900 dark:text-slate-100 text-sm">{stub.employer}</div>
                      <div className="text-xs text-slate-500">{new Date(stub.date).toLocaleDateString()}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-emerald-600 dark:text-emerald-400">{fmt(stub.netPay)}</div>
                      <div className="text-[10px] text-slate-400">Net · {fmt(stub.grossPay)} gross</div>
                    </div>
                  </div>
                ))}
                <Button variant="outline" className="w-full mt-1 text-sm" onClick={() => setLocation('/paystubs')}>
                  View All Paystubs
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
