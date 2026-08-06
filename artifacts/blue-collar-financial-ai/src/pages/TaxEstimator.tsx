/**
 * Tax Estimator page — 2026 tax year.
 *
 * Two modes:
 *   Quick Estimate  — auto-populated from existing paystubs + profile context.
 *   Detailed Estimate — full manual entry for every income / deduction source.
 *
 * Results update live as inputs change.  Tax calculations are client-side
 * pure functions (tax-engine.ts).  Saved scenarios are persisted server-side.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useAuth } from '@clerk/react';
import {
  Calculator, ChevronDown, ChevronUp, Info, AlertTriangle,
  Lightbulb, Save, FolderOpen, Trash2, CheckCircle2, RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useStore } from '@/lib/store';
import { US_STATE_CODES, TAX_FILING_STATUSES } from '@/lib/profile-context-api';
import {
  computeDetailedTax,
  buildQuickEstimateInput,
  blankDetailedInput,
  PERIODS_PER_YEAR,
  type TaxEngineInput,
  type TaxEngineResult,
  type PayFrequency,
} from '@/lib/tax-engine';
import type { FilingStatus } from '@/lib/tax-rules/index';
import {
  listTaxScenarios, createTaxScenario, deleteTaxScenario,
  type TaxScenario,
} from '@/lib/api';
import { TAX_RULES_2026 } from '@/lib/tax-rules/2026';

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmt(n: number, opts?: Intl.NumberFormatOptions) {
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-US', { maximumFractionDigits: 0, ...opts });
  return n < 0 ? `-$${s}` : `$${s}`;
}
function pct(r: number) { return `${(r * 100).toFixed(1)}%`; }
function num(v: string | number): number {
  const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : v;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function intNum(v: string | number): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : Math.floor(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ─── Small reusable components ────────────────────────────────────────────────

interface RowProps {
  label: string; value: string; sub?: string;
  accent?: 'green' | 'red' | 'blue'; bold?: boolean; indent?: boolean;
}
function Row({ label, value, sub, accent, bold, indent }: RowProps) {
  const valueColor =
    accent === 'green' ? 'text-emerald-400' :
    accent === 'red'   ? 'text-red-400' :
    accent === 'blue'  ? 'text-cyan-400' :
    'text-slate-200';
  return (
    <div className={`flex items-start justify-between gap-2 py-1.5 border-b border-white/5 last:border-0 ${indent ? 'pl-4' : ''}`}>
      <div>
        <div className={`text-sm ${bold ? 'font-semibold text-white' : 'text-slate-400'}`}>{label}</div>
        {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
      </div>
      <div className={`text-sm shrink-0 ${bold ? 'font-bold' : 'font-medium'} ${valueColor}`}>{value}</div>
    </div>
  );
}

function FieldRow({ label, value, onChange, hint, type = 'dollar' }: {
  label: string; value: number; onChange: (v: number) => void;
  hint?: string; type?: 'dollar' | 'integer';
}) {
  return (
    <div className="space-y-1">
      <Label className="text-slate-300 text-xs">{label}</Label>
      <div className="relative">
        {type === 'dollar' && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>}
        <Input
          type="number" min="0" step={type === 'integer' ? 1 : 100}
          value={value || ''}
          placeholder="0"
          onChange={e => onChange(type === 'integer' ? intNum(e.target.value) : num(e.target.value))}
          className={`h-10 bg-white/5 border-white/10 text-white text-sm ${type === 'dollar' ? 'pl-7' : ''}`}
        />
      </div>
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function SectionHeader({ title, open, onToggle }: {
  title: string; open: boolean; onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-sm font-semibold text-white"
    >
      {title}
      {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
    </button>
  );
}

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ level, score }: { level: string; score: number }) {
  const color =
    level === 'high'   ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' :
    level === 'medium' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
                         'bg-slate-500/15 text-slate-400 border-slate-500/30';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${color}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {level === 'high' ? 'High confidence' : level === 'medium' ? 'Medium confidence' : 'Low confidence'}
      {' '}· {score}%
    </span>
  );
}

// ─── Results panel ────────────────────────────────────────────────────────────

function ResultsPanel({ result, annualMode }: { result: TaxEngineResult; annualMode: boolean }) {
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [showOpps, setShowOpps] = useState(true);

  const divide = annualMode ? 1 : 12;
  const suffix = annualMode ? '/yr' : '/mo';
  const f = (n: number) => fmt(n / divide);

  const hasRefund = result.estimatedRefundOrOwed !== null;
  const refund = result.estimatedRefundOrOwed ?? 0;
  const isRefund = refund >= 0;

  return (
    <div className="space-y-4">
      {/* Primary result card */}
      <div className={`rounded-2xl border p-5 text-center ${isRefund && hasRefund
        ? 'border-emerald-500/30 bg-emerald-500/10'
        : hasRefund
        ? 'border-red-500/30 bg-red-500/10'
        : 'border-white/10 bg-white/5'}`}>
        {hasRefund ? (
          <>
            <div className="text-xs uppercase tracking-widest text-slate-400 mb-1">
              {isRefund ? 'Estimated Refund' : 'Estimated Amount Owed'}
            </div>
            <div className={`text-4xl font-black mb-2 ${isRefund ? 'text-emerald-400' : 'text-red-400'}`}>
              {isRefund ? '+' : ''}{fmt(Math.abs(refund))}
            </div>
            <div className="text-[11px] text-slate-500">Based on federal + state + payroll taxes</div>
          </>
        ) : (
          <>
            <div className="text-xs uppercase tracking-widest text-slate-400 mb-1">
              Total Estimated Tax
            </div>
            <div className="text-4xl font-black text-white mb-1">
              {fmt(result.totalEstimatedTax)}
            </div>
            <div className="text-xs text-slate-500">Enter YTD withholding to see refund/owed</div>
          </>
        )}
        <div className="mt-3 flex items-center justify-center gap-3">
          <ConfidenceBadge level={result.confidenceLevel} score={result.confidenceScore} />
          <span className="text-xs text-slate-500">Eff. rate {pct(result.effectiveTaxRate)}</span>
        </div>
      </div>

      {/* Annual / Monthly toggle */}
      <div className="flex gap-2">
        <button
          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${annualMode ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-white/5 text-slate-400 hover:text-white'}`}
          onClick={() => {/* handled by parent */}}
        >
          Annual
        </button>
        <button
          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${!annualMode ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-white/5 text-slate-400 hover:text-white'}`}
          onClick={() => {/* handled by parent */}}
        >
          Monthly
        </button>
      </div>

      {/* Tax breakdown */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader className="pb-2 pt-4">
          <button
            onClick={() => setShowBreakdown(b => !b)}
            className="flex items-center justify-between w-full text-sm font-semibold text-white"
          >
            Tax Breakdown
            {showBreakdown ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </CardHeader>
        {showBreakdown && (
          <CardContent className="pb-4 space-y-0">
            <Row label="Gross Income" value={f(result.totalGrossIncome)} bold />
            {result.totalPreTaxDeductions > 0 && (
              <Row label="Pre-tax Deductions" value={`−${f(result.totalPreTaxDeductions)}`} indent />
            )}
            {result.seTaxDeduction > 0 && (
              <Row label="SE Tax Deduction" value={`−${f(result.seTaxDeduction)}`} indent />
            )}
            {result.traditionalIRADeduction > 0 && (
              <Row label="IRA Deduction" value={`−${f(result.traditionalIRADeduction)}`} indent />
            )}
            <Row label="Adjusted Gross Income" value={f(result.adjustedGrossIncome)} />
            <Row label="Standard Deduction" value={`−${f(result.standardDeduction)}`} indent />
            {result.qualifiedOvertimeDeduction > 0 && (
              <Row label="Qualified OT Deduction" value={`−${f(result.qualifiedOvertimeDeduction)}`} indent
                sub="2026 FLSA premium deduction" />
            )}
            <Row label="Federal Taxable Income" value={f(result.federalTaxableIncome)} />
            <div className="py-1" />
            <Row label={`Federal Income Tax`}
              value={f(result.federalIncomeTax)}
              sub={`${pct(result.marginalBracketRate)} marginal bracket`} />
            {(result.childTaxCredit + result.otherDependentCredit) > 0 && (
              <Row label="Child / Dependent Credits" value={`−${fmt((result.childTaxCredit + result.otherDependentCredit) / divide)}`} indent accent="green" />
            )}
            <Row label="Social Security (6.2%)" value={f(result.socialSecurityTax)} />
            <Row label="Medicare (1.45%)" value={f(result.medicareTax)} />
            {result.additionalMedicareTax > 0 && (
              <Row label="Additional Medicare (0.9%)" value={f(result.additionalMedicareTax)} />
            )}
            {result.seTax > 0 && (
              <Row label="Self-Employment Tax" value={f(result.seTax)} sub="15.3% on 92.35% of net SE income" />
            )}
            {result.stateIncomeTax !== null ? (
              <Row label="Oklahoma State Tax" value={f(result.stateIncomeTax)} />
            ) : result.stateIncomeTax === null && (
              <Row label="State Income Tax" value="—" sub="Add state in settings or form" />
            )}
            <div className="py-1" />
            <Row label="Total Estimated Tax" value={f(result.totalEstimatedTax)} bold accent="blue" />
            <Row label="Effective Rate" value={pct(result.effectiveTaxRate)} bold />
            {hasRefund && result.estimatedRemainingTaxPerPeriod !== null && (
              <>
                <div className="py-1" />
                <Row
                  label={`Suggested per-paycheck withholding`}
                  value={fmt(result.estimatedRemainingTaxPerPeriod)}
                  sub={`${result.remainingPeriods} pay periods remaining`}
                  accent={result.estimatedRemainingTaxPerPeriod > 0 ? 'red' : 'green'}
                />
              </>
            )}
            {result.overtimeIncrementalTax > 0 && (
              <>
                <div className="py-1" />
                <Row label="Incremental tax on overtime" value={f(result.overtimeIncrementalTax)} sub="Extra tax from all OT hours combined" />
                {result.overtimeEffectiveTaxRate !== null && (
                  <Row label="OT effective tax rate" value={pct(result.overtimeEffectiveTaxRate)} />
                )}
                <Row label="Estimated after-tax overtime" value={f(result.estimatedAfterTaxOvertime)} accent="green" />
              </>
            )}
          </CardContent>
        )}
      </Card>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="space-y-2">
          {result.warnings.map((w, i) => (
            <div key={i} className="flex gap-2 items-start text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Tax-saving opportunities */}
      {result.taxSavingOpportunities.length > 0 && (
        <Card className="bg-white/5 border-white/10">
          <CardHeader className="pb-2 pt-4">
            <button
              onClick={() => setShowOpps(o => !o)}
              className="flex items-center justify-between w-full text-sm font-semibold text-white"
            >
              <span className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-400" />
                Tax-Saving Opportunities
              </span>
              {showOpps ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </CardHeader>
          {showOpps && (
            <CardContent className="pb-4 space-y-3">
              {result.taxSavingOpportunities.map((opp, i) => (
                <div key={i} className="rounded-xl bg-emerald-500/5 border border-emerald-500/15 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold text-emerald-400">{opp.title}</div>
                    {opp.estimatedAnnualSaving > 0 && (
                      <div className="text-xs font-bold text-emerald-400 shrink-0">
                        ~{fmt(opp.estimatedAnnualSaving)}/yr
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{opp.description}</p>
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      )}

      {/* Disclaimer */}
      <div className="flex gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-3 text-[11px] leading-relaxed text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span>
          This is an estimate for informational purposes only — not professional tax advice.
          {' '}Overtime is not taxed at a special rate; only the qualified FLSA premium may be deductible.
          {' '}Excludes itemised deductions, most credits, local taxes, and complex situations.
          {' '}State support is currently Oklahoma only. Consult a qualified tax professional for your specific situation.
        </span>
      </div>
    </div>
  );
}

// ─── Quick input form ─────────────────────────────────────────────────────────

interface QuickOverrides {
  annualBonus: number;
  annualStandbyPay: number;
  additionalTaxablePerDiem: number;
  additionalAnnualIncome: number;
  filingStatus: FilingStatus;
  stateCode: string;
  qualifyingChildren: number;
  otherDependents: number;
  annualPreTaxDeductions: number;
  payFrequency: PayFrequency;
  selectedAll: boolean;
}

function QuickForm({
  overrides, onChange, paystubCount, hourlyRate,
}: {
  overrides: QuickOverrides;
  onChange: (o: Partial<QuickOverrides>) => void;
  paystubCount: number;
  hourlyRate: number;
}) {
  const set = (k: keyof QuickOverrides) => (v: number | string) =>
    onChange({ [k]: v });

  return (
    <div className="space-y-4">
      {paystubCount === 0 && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2.5 text-xs text-amber-400 flex gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          No paystubs found. Scan a document or add one manually on the Paystubs page to auto-populate this estimate.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-slate-300 text-xs">Pay Frequency</Label>
          <Select value={overrides.payFrequency} onValueChange={v => set('payFrequency')(v as PayFrequency)}>
            <SelectTrigger className="h-10 bg-white/5 border-white/10 text-white text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['Weekly', 'Bi-Weekly', 'Semi-Monthly', 'Monthly'] as PayFrequency[]).map(f => (
                <SelectItem key={f} value={f}>{f} ({PERIODS_PER_YEAR[f]}/yr)</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-slate-300 text-xs">State</Label>
          <Select value={overrides.stateCode || 'none'} onValueChange={v => set('stateCode')(v === 'none' ? '' : v)}>
            <SelectTrigger className="h-10 bg-white/5 border-white/10 text-white text-sm">
              <SelectValue placeholder="Select state" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No state</SelectItem>
              {US_STATE_CODES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-slate-300 text-xs">Filing Status</Label>
        <Select value={overrides.filingStatus} onValueChange={v => set('filingStatus')(v as FilingStatus)}>
          <SelectTrigger className="h-10 bg-white/5 border-white/10 text-white text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAX_FILING_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="Qualifying Children" value={overrides.qualifyingChildren}
          onChange={v => set('qualifyingChildren')(v)} type="integer"
          hint="$2,000 credit each" />
        <FieldRow label="Other Dependents" value={overrides.otherDependents}
          onChange={v => set('otherDependents')(v)} type="integer"
          hint="$500 credit each" />
      </div>

      <div className="space-y-0.5">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-1">Income Additions</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="Annual Bonus" value={overrides.annualBonus}
          onChange={v => set('annualBonus')(v)} />
        <FieldRow label="Standby / On-Call" value={overrides.annualStandbyPay}
          onChange={v => set('annualStandbyPay')(v)} hint="Taxable" />
        <FieldRow label="Taxable Per Diem" value={overrides.additionalTaxablePerDiem}
          onChange={v => set('additionalTaxablePerDiem')(v)} hint="Above IRS limits" />
        <FieldRow label="Other Taxable Income" value={overrides.additionalAnnualIncome}
          onChange={v => set('additionalAnnualIncome')(v)} hint="2nd job, etc." />
      </div>

      <div className="space-y-0.5">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-1">Deductions</div>
      </div>

      <FieldRow label="Annual Pre-Tax Deductions" value={overrides.annualPreTaxDeductions}
        onChange={v => set('annualPreTaxDeductions')(v)}
        hint="401(k), HSA, health insurance combined" />

      {hourlyRate === 0 && paystubCount > 0 && (
        <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 px-3 py-2 text-xs text-blue-400 flex gap-2">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          No hourly rate set in your profile. Estimating from gross pay. Set your hourly rate in Settings for a more accurate overtime breakdown.
        </div>
      )}
    </div>
  );
}

// ─── Detailed input form ──────────────────────────────────────────────────────

function DetailedForm({
  input, onChange,
}: { input: TaxEngineInput; onChange: (patch: Partial<TaxEngineInput>) => void }) {
  const [sections, setSections] = useState({
    filing: true, wages: true, perDiem: false, addIncome: false,
    deductions: true, ira: false, ytd: false,
  });
  const toggle = (k: keyof typeof sections) =>
    setSections(s => ({ ...s, [k]: !s[k] }));

  return (
    <div className="space-y-3">
      {/* Filing */}
      <div>
        <SectionHeader title="Filing Information" open={sections.filing} onToggle={() => toggle('filing')} />
        {sections.filing && (
          <div className="mt-3 space-y-3 px-1">
            <div className="space-y-1">
              <Label className="text-slate-300 text-xs">Filing Status</Label>
              <Select value={input.filingStatus} onValueChange={v => onChange({ filingStatus: v as FilingStatus })}>
                <SelectTrigger className="h-10 bg-white/5 border-white/10 text-white text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TAX_FILING_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-slate-300 text-xs">State</Label>
                <Select value={input.stateCode || 'none'} onValueChange={v => onChange({ stateCode: v === 'none' ? '' : v })}>
                  <SelectTrigger className="h-10 bg-white/5 border-white/10 text-white text-sm">
                    <SelectValue placeholder="No state" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No state</SelectItem>
                    {US_STATE_CODES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-slate-300 text-xs">Pay Frequency</Label>
                <Select value={input.payFrequency} onValueChange={v => onChange({ payFrequency: v as PayFrequency })}>
                  <SelectTrigger className="h-10 bg-white/5 border-white/10 text-white text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['Weekly', 'Bi-Weekly', 'Semi-Monthly', 'Monthly'] as PayFrequency[]).map(f => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Qualifying Children" value={input.qualifyingChildren}
                onChange={v => onChange({ qualifyingChildren: Math.floor(v) })} type="integer" hint="$2,000 credit each" />
              <FieldRow label="Other Dependents" value={input.otherDependents}
                onChange={v => onChange({ otherDependents: Math.floor(v) })} type="integer" hint="$500 credit each" />
            </div>
          </div>
        )}
      </div>

      {/* W-2 Wages */}
      <div>
        <SectionHeader title="W-2 Wages" open={sections.wages} onToggle={() => toggle('wages')} />
        {sections.wages && (
          <div className="mt-3 grid grid-cols-2 gap-3 px-1">
            <FieldRow label="Annual Regular Wages" value={input.annualRegularWages}
              onChange={v => onChange({ annualRegularWages: v })} />
            <FieldRow label="Annual Overtime Wages" value={input.annualOvertimeWages}
              onChange={v => onChange({ annualOvertimeWages: v })} />
            <FieldRow label="Annual Double-Time Wages" value={input.annualDoubleTimeWages}
              onChange={v => onChange({ annualDoubleTimeWages: v })} />
            <FieldRow label="Annual Bonuses" value={input.annualBonuses}
              onChange={v => onChange({ annualBonuses: v })} />
            <FieldRow label="Standby / On-Call Pay" value={input.annualStandbyPay}
              onChange={v => onChange({ annualStandbyPay: v })} hint="Taxable" />
            <FieldRow label="FLSA OT Premium (deductible)" value={input.annualQualifiedOvertimePremium}
              onChange={v => onChange({ annualQualifiedOvertimePremium: v })}
              hint="0.5× for 1.5x, 1× for 2x rate" />
          </div>
        )}
      </div>

      {/* Per Diem */}
      <div>
        <SectionHeader title="Per Diem" open={sections.perDiem} onToggle={() => toggle('perDiem')} />
        {sections.perDiem && (
          <div className="mt-3 grid grid-cols-2 gap-3 px-1">
            <FieldRow label="Non-Taxable Per Diem" value={input.annualNonTaxablePerDiem}
              onChange={v => onChange({ annualNonTaxablePerDiem: v })}
              hint="Qualifying IRS reimbursement" />
            <FieldRow label="Taxable Per Diem" value={input.annualTaxablePerDiem}
              onChange={v => onChange({ annualTaxablePerDiem: v })}
              hint="Above IRS per-diem limits" />
          </div>
        )}
      </div>

      {/* Additional income */}
      <div>
        <SectionHeader title="Additional Income" open={sections.addIncome} onToggle={() => toggle('addIncome')} />
        {sections.addIncome && (
          <div className="mt-3 grid grid-cols-2 gap-3 px-1">
            <FieldRow label="Second Job W-2 Wages" value={input.secondJobAnnualWages}
              onChange={v => onChange({ secondJobAnnualWages: v })} />
            <FieldRow label="Spouse Wages (MFJ)" value={input.spouseAnnualWages}
              onChange={v => onChange({ spouseAnnualWages: v })} />
            <FieldRow label="1099 / Schedule C Income" value={input.annual1099Income}
              onChange={v => onChange({ annual1099Income: v })} />
            <FieldRow label="Schedule C Expenses" value={input.annual1099Expenses}
              onChange={v => onChange({ annual1099Expenses: v })} />
          </div>
        )}
      </div>

      {/* Pre-tax deductions */}
      <div>
        <SectionHeader title="Pre-Tax Deductions" open={sections.deductions} onToggle={() => toggle('deductions')} />
        {sections.deductions && (
          <div className="mt-3 space-y-3 px-1">
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label={`Traditional 401(k) (limit $${TAX_RULES_2026.traditional401kLimit.toLocaleString()})`}
                value={input.annualTraditional401k}
                onChange={v => onChange({ annualTraditional401k: v })} />
              <FieldRow label="HSA Contributions"
                value={input.annualHSA}
                onChange={v => onChange({ annualHSA: v })}
                hint={`Self: $${TAX_RULES_2026.hsaLimitSelf.toLocaleString()} / Family: $${TAX_RULES_2026.hsaLimitFamily.toLocaleString()}`} />
              <FieldRow label="Health Insurance Premiums"
                value={input.annualHealthInsurancePremiums}
                onChange={v => onChange({ annualHealthInsurancePremiums: v })}
                hint="Employer-sponsored (Section 125)" />
              <FieldRow label="Other Pre-Tax Deductions"
                value={input.annualOtherPreTaxDeductions}
                onChange={v => onChange({ annualOtherPreTaxDeductions: v })} />
            </div>
            <div className="rounded-xl bg-blue-500/10 border border-blue-500/15 px-3 py-2 text-[11px] text-blue-400">
              Roth 401(k) contributions don't reduce taxable income or FICA and are not entered here.
            </div>
          </div>
        )}
      </div>

      {/* IRA */}
      <div>
        <SectionHeader title="IRA Contributions" open={sections.ira} onToggle={() => toggle('ira')} />
        {sections.ira && (
          <div className="mt-3 space-y-3 px-1">
            <FieldRow label={`Traditional IRA (limit $${TAX_RULES_2026.iraLimit.toLocaleString()})`}
              value={input.annualTraditionalIRA}
              onChange={v => onChange({ annualTraditionalIRA: v })} />
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="coveredByPlan"
                checked={input.coveredByEmployerPlan}
                onChange={e => onChange({ coveredByEmployerPlan: e.target.checked })}
                className="h-4 w-4 accent-emerald-500"
              />
              <Label htmlFor="coveredByPlan" className="text-slate-300 text-xs cursor-pointer">
                Covered by employer retirement plan (affects IRA deductibility phase-out)
              </Label>
            </div>
          </div>
        )}
      </div>

      {/* YTD */}
      <div>
        <SectionHeader title="Year-to-Date Withholding" open={sections.ytd} onToggle={() => toggle('ytd')} />
        {sections.ytd && (
          <div className="mt-3 space-y-3 px-1">
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Federal Income Tax Withheld" value={input.ytdFederalWithheld}
                onChange={v => onChange({ ytdFederalWithheld: v })} />
              <FieldRow label="State Tax Withheld" value={input.ytdStateWithheld}
                onChange={v => onChange({ ytdStateWithheld: v })} />
              <FieldRow label="Social Security Withheld" value={input.ytdSocialSecurityWithheld}
                onChange={v => onChange({ ytdSocialSecurityWithheld: v })} />
              <FieldRow label="Medicare Withheld" value={input.ytdMedicareWithheld}
                onChange={v => onChange({ ytdMedicareWithheld: v })} />
              <FieldRow label="YTD Gross Pay" value={input.ytdGrossPay}
                onChange={v => onChange({ ytdGrossPay: v })}
                hint="Used to estimate remaining periods" />
              <FieldRow label="Extra Withholding / Period" value={input.additionalFederalWithholdingPerPeriod}
                onChange={v => onChange({ additionalFederalWithholdingPerPeriod: v })} />
            </div>
            <div className="text-[11px] text-slate-500">
              Find these totals on your most recent paystub's year-to-date section.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Scenario comparison table ────────────────────────────────────────────────

function ScenarioTable({ baseInput }: { baseInput: TaxEngineInput }) {
  const max401k = TAX_RULES_2026.traditional401kLimit;

  const scenarios: { label: string; input: TaxEngineInput }[] = [
    { label: 'Current', input: baseInput },
    {
      label: `Max 401(k) ($${max401k.toLocaleString()})`,
      input: { ...baseInput, annualTraditional401k: max401k },
    },
    {
      label: 'No Overtime',
      input: { ...baseInput, annualOvertimeWages: 0, annualDoubleTimeWages: 0, annualQualifiedOvertimePremium: 0 },
    },
    {
      label: '+$6k 401(k)',
      input: { ...baseInput, annualTraditional401k: (baseInput.annualTraditional401k ?? 0) + 6_000 },
    },
    {
      label: '+$10k 1099',
      input: { ...baseInput, annual1099Income: (baseInput.annual1099Income ?? 0) + 10_000 },
    },
  ];

  const results = useMemo(() => scenarios.map(s => computeDetailedTax(s.input)), [baseInput]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left text-slate-400 font-semibold pb-3 pr-4 whitespace-nowrap">Metric</th>
            {scenarios.map((s, i) => (
              <th key={i} className={`text-right text-xs font-semibold pb-3 px-3 whitespace-nowrap ${i === 0 ? 'text-blue-400' : 'text-slate-300'}`}>
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            { label: 'Gross Income', get: (r: TaxEngineResult) => fmt(r.totalGrossIncome) },
            { label: 'Pre-Tax Deductions', get: (r: TaxEngineResult) => fmt(r.totalPreTaxDeductions) },
            { label: 'Federal Taxable Income', get: (r: TaxEngineResult) => fmt(r.federalTaxableIncome) },
            { label: 'Federal Income Tax', get: (r: TaxEngineResult) => fmt(r.federalIncomeTax) },
            { label: 'FICA (SS + Medicare)', get: (r: TaxEngineResult) => fmt(r.socialSecurityTax + r.medicareTax + r.additionalMedicareTax) },
            { label: 'State Tax', get: (r: TaxEngineResult) => r.stateIncomeTax !== null ? fmt(r.stateIncomeTax) : '—' },
            { label: 'Total Tax', get: (r: TaxEngineResult) => fmt(r.totalEstimatedTax) },
            { label: 'Effective Rate', get: (r: TaxEngineResult) => pct(r.effectiveTaxRate) },
          ].map(row => (
            <tr key={row.label} className="border-t border-white/5">
              <td className="text-slate-400 py-2 pr-4 whitespace-nowrap">{row.label}</td>
              {results.map((r, i) => (
                <td key={i} className={`text-right py-2 px-3 font-mono whitespace-nowrap ${i === 0 ? 'text-blue-300' : 'text-slate-300'}`}>
                  {row.get(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TaxEstimator() {
  const { getToken } = useAuth();
  const { paystubs, profile, profileContext } = useStore();
  const [mode, setMode] = useState<'quick' | 'detailed'>('quick');
  const [annualMode, setAnnualMode] = useState(true);
  const [showComparison, setShowComparison] = useState(false);

  // Quick mode overrides
  const [quickOverrides, setQuickOverrides] = useState<QuickOverrides>(() => ({
    annualBonus: 0,
    annualStandbyPay: 0,
    additionalTaxablePerDiem: 0,
    additionalAnnualIncome: 0,
    filingStatus: (profileContext?.taxFilingStatus ?? 'Single') as FilingStatus,
    stateCode: profileContext?.stateCode ?? '',
    qualifyingChildren: profileContext?.qualifyingChildren ?? 0,
    otherDependents: profileContext?.otherDependents ?? 0,
    annualPreTaxDeductions: profileContext?.annualPreTaxDeductions ?? 0,
    payFrequency: (profile?.payFrequency as PayFrequency) ?? 'Weekly',
    selectedAll: true,
  }));

  // Detailed mode input
  const [detailedInput, setDetailedInput] = useState<TaxEngineInput>(() =>
    blankDetailedInput(
      (profileContext?.taxFilingStatus ?? 'Single') as FilingStatus,
      profileContext?.stateCode ?? '',
      (profile?.payFrequency as PayFrequency) ?? 'Weekly',
    ),
  );

  // Saved scenarios
  const [savedScenarios, setSavedScenarios] = useState<TaxScenario[]>([]);
  const [scenariosLoaded, setScenariosLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [scenarioName, setScenarioName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Build the active TaxEngineInput
  const activeInput = useMemo<TaxEngineInput>(() => {
    if (mode === 'detailed') return detailedInput;

    // De-duplicate paystubs by id before annualising
    const uniqueStubs = Array.from(new Map(paystubs.map(p => [p.id, p])).values());

    return buildQuickEstimateInput({
      paystubs: uniqueStubs.map(p => ({
        regularHours: p.regularHours,
        overtimeHours: p.overtimeHours,
        doubleTimeHours: p.doubleTimeHours,
        perDiem: p.perDiem,
        grossPay: p.grossPay,
        taxes: p.taxes,
      })),
      hourlyRate: profile?.hourlyRate ?? 0,
      payFrequency: quickOverrides.payFrequency,
      filingStatus: quickOverrides.filingStatus,
      stateCode: quickOverrides.stateCode,
      qualifyingChildren: quickOverrides.qualifyingChildren,
      otherDependents: quickOverrides.otherDependents,
      annualPreTaxDeductions: quickOverrides.annualPreTaxDeductions,
      additionalAnnualTaxableIncome:
        quickOverrides.annualBonus +
        quickOverrides.annualStandbyPay +
        quickOverrides.additionalAnnualIncome,
      additionalTaxablePerDiem: quickOverrides.additionalTaxablePerDiem,
    });
  }, [mode, detailedInput, quickOverrides, paystubs, profile]);

  const result = useMemo(() => computeDetailedTax(activeInput), [activeInput]);

  // Load saved scenarios
  const loadScenarios = useCallback(async () => {
    const token = await getToken().catch(() => null);
    if (!token) return;
    try {
      const list = await listTaxScenarios(token);
      setSavedScenarios(list);
      setScenariosLoaded(true);
    } catch { /* silent — scenarios are an enhancement */ }
  }, [getToken]);

  // Load on mount
  React.useEffect(() => { loadScenarios(); }, [loadScenarios]);

  // Save scenario
  const handleSave = async () => {
    if (!scenarioName.trim()) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not signed in');
      const scenario = await createTaxScenario(token, {
        name: scenarioName.trim(),
        taxYear: activeInput.taxYear,
        inputs: activeInput as unknown as Record<string, unknown>,
        result: result as unknown as Record<string, unknown>,
      });
      setSavedScenarios(s => [scenario, ...s]);
      setShowSaveDialog(false);
      setScenarioName('');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  // Load a saved scenario
  const loadScenario = (scenario: TaxScenario) => {
    try {
      const input = scenario.inputs as unknown as TaxEngineInput;
      setDetailedInput(input);
      setMode('detailed');
    } catch { /* malformed saved data */ }
  };

  // Delete a saved scenario
  const deleteScenario = async (id: string) => {
    const token = await getToken().catch(() => null);
    if (!token) return;
    try {
      await deleteTaxScenario(token, id);
      setSavedScenarios(s => s.filter(sc => sc.id !== id));
    } catch { /* silent */ }
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-2">
            <Calculator className="h-7 w-7 text-emerald-400" />
            Tax Estimator
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            2026 federal + state estimate · Not tax advice
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Saved scenarios dropdown */}
          {scenariosLoaded && savedScenarios.length > 0 && (
            <div className="relative group">
              <Button variant="outline" size="sm"
                className="border-white/10 bg-white/5 text-slate-300 hover:text-white gap-2">
                <FolderOpen className="h-4 w-4" /> Saved ({savedScenarios.length})
              </Button>
              <div className="absolute right-0 top-full mt-1 w-64 rounded-xl bg-slate-800 border border-white/10 shadow-2xl z-50 hidden group-hover:block">
                <div className="p-2 space-y-1">
                  {savedScenarios.map(sc => (
                    <div key={sc.id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-white/5 group/item">
                      <button
                        onClick={() => loadScenario(sc)}
                        className="text-sm text-slate-300 hover:text-white text-left flex-1 truncate"
                      >
                        {sc.name}
                      </button>
                      <button onClick={() => deleteScenario(sc.id)}
                        className="text-slate-600 hover:text-red-400 opacity-0 group-hover/item:opacity-100 transition-opacity">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Save button */}
          {showSaveDialog ? (
            <div className="flex items-center gap-2">
              <Input
                value={scenarioName}
                onChange={e => setScenarioName(e.target.value)}
                placeholder="Scenario name…"
                className="h-9 w-44 bg-white/5 border-white/10 text-white text-sm"
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                autoFocus
              />
              <Button size="sm" onClick={handleSave} disabled={isSaving || !scenarioName.trim()}
                className="bg-emerald-600 hover:bg-emerald-500 text-white h-9 gap-1">
                {isSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowSaveDialog(false)}
                className="text-slate-400 h-9">✕</Button>
            </div>
          ) : (
            <Button variant="outline" size="sm"
              onClick={() => setShowSaveDialog(true)}
              className="border-white/10 bg-white/5 text-slate-300 hover:text-white gap-2">
              <Save className="h-4 w-4" /> Save
            </Button>
          )}
        </div>
      </div>

      {saveError && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {saveError}
        </div>
      )}

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-6 items-start">
        {/* Left: Input panel */}
        <div className="space-y-4">
          <Tabs value={mode} onValueChange={v => setMode(v as 'quick' | 'detailed')}>
            <TabsList className="w-full bg-white/5 border border-white/10">
              <TabsTrigger value="quick" className="flex-1 text-slate-400 data-[state=active]:text-white data-[state=active]:bg-white/10">
                Quick Estimate
              </TabsTrigger>
              <TabsTrigger value="detailed" className="flex-1 text-slate-400 data-[state=active]:text-white data-[state=active]:bg-white/10">
                Detailed Estimate
              </TabsTrigger>
            </TabsList>

            <div className="mt-1">
              {mode === 'quick' && (
                <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/15 px-3 py-2 text-[11px] text-emerald-400 flex gap-2 mb-3">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  Auto-populated from {paystubs.length} paystub{paystubs.length !== 1 ? 's' : ''}.
                  {' '}Paystubs are de-duplicated by ID before annualising.
                  {' '}Override any value below.
                </div>
              )}

              <TabsContent value="quick" className="mt-0">
                <QuickForm
                  overrides={quickOverrides}
                  onChange={patch => setQuickOverrides(o => ({ ...o, ...patch }))}
                  paystubCount={paystubs.length}
                  hourlyRate={profile?.hourlyRate ?? 0}
                />
              </TabsContent>

              <TabsContent value="detailed" className="mt-0">
                <DetailedForm
                  input={detailedInput}
                  onChange={patch => setDetailedInput(d => ({ ...d, ...patch }))}
                />
              </TabsContent>
            </div>
          </Tabs>
        </div>

        {/* Right: Results panel */}
        <div className="lg:sticky lg:top-6">
          {/* Annual / Monthly toggle above results */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setAnnualMode(true)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors border ${annualMode ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'}`}>
              Annual
            </button>
            <button
              onClick={() => setAnnualMode(false)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors border ${!annualMode ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'}`}>
              Monthly
            </button>
          </div>
          <ResultsPanel result={result} annualMode={annualMode} />
        </div>
      </div>

      {/* Scenario comparison */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader className="pb-2">
          <button
            onClick={() => setShowComparison(c => !c)}
            className="flex items-center justify-between w-full text-sm font-semibold text-white"
          >
            <span>Compare Scenarios</span>
            {showComparison ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {!showComparison && (
            <p className="text-xs text-slate-500 mt-1">
              See how different 401(k) contributions, overtime, and side income affect your tax.
            </p>
          )}
        </CardHeader>
        {showComparison && (
          <CardContent className="pt-2 pb-4">
            <ScenarioTable baseInput={activeInput} />
          </CardContent>
        )}
      </Card>
    </div>
  );
}
