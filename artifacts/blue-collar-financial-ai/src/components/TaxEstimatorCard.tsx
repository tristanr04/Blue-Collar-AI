import React, { useMemo } from 'react';
import { Calculator, Info, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { estimateWageAndOvertimeTax, type FilingStatus } from '@/lib/tax-estimator';
import { type ServerProfileContext, type Paystub, type Profile } from '@/lib/store';

interface TaxEstimatorCardProps {
  profileContext: ServerProfileContext | null;
  profile: Profile;
  paystubs: Paystub[];
  /** Pay-period multiplier to annualise (e.g. 52 for weekly). */
  multiplier: number;
}

function fmt(n: number, opts?: Intl.NumberFormatOptions) {
  const abs = Math.abs(n);
  const s = abs.toLocaleString(undefined, { maximumFractionDigits: 0, ...opts });
  return n < 0 ? `-$${s}` : `$${s}`;
}

function pct(rate: number) {
  return `${(rate * 100).toFixed(1)}%`;
}

/** Map profileContext taxFilingStatus to the FilingStatus enum expected by the estimator. */
function toFilingStatus(raw: string | undefined): FilingStatus {
  const map: Record<string, FilingStatus> = {
    'Single': 'Single',
    'Married Filing Jointly': 'Married Filing Jointly',
    'Married Filing Separately': 'Married Filing Separately',
    'Head of Household': 'Head of Household',
  };
  return map[raw ?? ''] ?? 'Single';
}

interface RowProps { label: string; value: string; sub?: string; accent?: boolean; warn?: boolean }
function Row({ label, value, sub, accent, warn }: RowProps) {
  return (
    <div className="flex items-start justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div>
        <div className="text-sm text-slate-700 dark:text-slate-300">{label}</div>
        {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
      </div>
      <div className={`text-sm font-semibold shrink-0 ${warn ? 'text-amber-600' : accent ? 'text-emerald-600' : 'text-slate-900 dark:text-white'}`}>
        {value}
      </div>
    </div>
  );
}

export function TaxEstimatorCard({ profileContext, profile, paystubs, multiplier }: TaxEstimatorCardProps) {
  const latestStub = useMemo(() => {
    if (!paystubs.length) return null;
    return [...paystubs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  }, [paystubs]);

  if (!latestStub) {
    return (
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="h-4 w-4 text-emerald-600" /> 2026 Tax &amp; Overtime Estimate
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-500">
          Add a paystub to estimate your 2026 federal taxes and overtime take-home.
        </CardContent>
      </Card>
    );
  }

  if (!profileContext) {
    return (
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="h-4 w-4 text-emerald-600" /> 2026 Tax &amp; Overtime Estimate
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-500">
          Complete your Tax &amp; State Context in Settings to see personalised 2026 tax estimates.
        </CardContent>
      </Card>
    );
  }

  const hourlyRate = profile.hourlyRate ?? 0;

  // Build annualised wage inputs from the most recent stub × pay-period multiplier.
  // Per-diem is excluded as it is treated as tax-exempt reimbursement by default.
  let annualRegularWages: number;
  let annualOvertimeWages: number;
  let annualQualifiedOvertimePremium: number;

  if (hourlyRate > 0) {
    annualRegularWages = latestStub.regularHours * hourlyRate * multiplier;
    annualOvertimeWages = (latestStub.overtimeHours * hourlyRate * 1.5 + latestStub.doubleTimeHours * hourlyRate * 2) * multiplier;
    // FLSA qualified overtime premium = 0.5x for time-and-a-half, 1x for double-time
    annualQualifiedOvertimePremium = (latestStub.overtimeHours * hourlyRate * 0.5 + latestStub.doubleTimeHours * hourlyRate) * multiplier;
  } else {
    // No hourly rate — use grossPay as a proxy, assume all regular
    annualRegularWages = latestStub.grossPay * multiplier;
    annualOvertimeWages = 0;
    annualQualifiedOvertimePremium = 0;
  }

  const estimate = estimateWageAndOvertimeTax({
    filingStatus: toFilingStatus(profileContext.taxFilingStatus),
    stateCode: profileContext.stateCode ?? '',
    annualRegularWages,
    annualOvertimeWages,
    annualQualifiedOvertimePremium,
    annualPretaxDeductions: profileContext.annualPreTaxDeductions ?? 0,
    annualOtherTaxableIncome: profileContext.additionalAnnualIncome ?? 0,
  });

  const hasState = Boolean(profileContext.stateCode);
  const stateSupported = profileContext.stateCode === 'OK';

  return (
    <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-4 w-4 text-emerald-600" /> 2026 Tax &amp; Overtime Estimate
            </CardTitle>
            <div className="mt-1 text-xs text-slate-500">
              Based on most recent paystub · {profileContext.taxFilingStatus}
              {profileContext.stateCode ? ` · ${profileContext.stateCode}` : ''}
            </div>
          </div>
          <div className="rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-center shrink-0">
            <div className="text-xl font-bold text-slate-900 dark:text-white">{pct(estimate.effectiveTaxRate)}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Eff. Rate</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-0">
        {/* Wages */}
        <Row label="Est. annual gross wages" value={fmt(annualRegularWages + annualOvertimeWages)} sub="Regular + overtime, excluding per diem" />
        <Row label="  Regular wages" value={fmt(annualRegularWages)} />
        {annualOvertimeWages > 0 && (
          <>
            <Row label="  Overtime wages" value={fmt(annualOvertimeWages)} />
            <Row label="  Qualified overtime premium (deductible)" value={fmt(estimate.qualifiedOvertimeDeduction)} />
          </>
        )}
        {/* Taxes */}
        <div className="pt-1" />
        <Row label="Federal income tax" value={fmt(estimate.federalIncomeTax)} />
        <Row
          label="State income tax"
          value={estimate.stateIncomeTax !== null ? fmt(estimate.stateIncomeTax) : '—'}
          sub={!hasState ? 'Add state in Settings' : !stateSupported ? `${profileContext.stateCode} not yet supported` : undefined}
          warn={hasState && !stateSupported}
        />
        <Row label="Social Security (6.2%)" value={fmt(estimate.socialSecurityTax)} />
        <Row label="Medicare (1.45%)" value={fmt(estimate.medicareTax)} />
        {estimate.additionalMedicareTax > 0 && (
          <Row label="Additional Medicare (0.9%)" value={fmt(estimate.additionalMedicareTax)} />
        )}
        <Row label="Total estimated tax" value={fmt(estimate.totalEstimatedTax)} accent />
        {/* Overtime breakdown */}
        {annualOvertimeWages > 0 && estimate.overtimeIncrementalTax > 0 && (
          <>
            <div className="pt-1" />
            <Row
              label="Incremental tax on overtime"
              value={fmt(estimate.overtimeIncrementalTax)}
              sub="Additional tax from all OT hours combined"
            />
            {estimate.overtimeEffectiveTaxRate !== null && (
              <Row label="Effective OT tax rate" value={pct(estimate.overtimeEffectiveTaxRate)} />
            )}
            <Row label="Est. after-tax overtime" value={fmt(estimate.estimatedAfterTaxOvertime)} accent />
          </>
        )}

        {/* Warnings */}
        {estimate.warnings.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {estimate.warnings.map((w, i) => (
              <div key={i} className="flex gap-2 items-start text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* Disclosures */}
        <div className="mt-3 flex gap-2 border-t border-slate-100 dark:border-slate-800 pt-3 text-[11px] leading-relaxed text-slate-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Overtime is not subject to a separate special tax rate. Payroll withholding may look higher on a large check because the check is annualised. Final tax is determined using progressive annual tax rules.
            {' '}This is an estimate only — not tax advice. State tax support is currently Oklahoma only; other states show federal totals only.
            {' '}Excludes credits, itemised deductions, local taxes, and most special tax situations.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
