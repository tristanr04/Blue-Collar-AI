import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  Upload, ScanLine, CheckCircle2, AlertTriangle, X, Plus, Trash2,
  ArrowRight, ShieldCheck, RotateCcw, ChevronDown, ChevronDown as ChevronUp,
  Loader2, FileImage, ThumbsUp, ThumbsDown, Edit2, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@clerk/react';
import { useStore } from '@/lib/store';
import { scanFile, ScanResult, ScanFieldValue, InstitutionInfo } from '@/lib/api';
import { fingerprintFile, isDuplicateFingerprint } from '@/lib/account-matching';
import { buildUpdatePlan, applyUpdatePlan, type UpdatePlan, type UpdatePlanEntry, type MatchChoice } from '@/lib/financialUpdater';
import { fileIdempotencyKey } from '@/lib/financialMatcher';
import { useJobQueue } from '@/lib/jobQueue';

// ─── Document types ───────────────────────────────────────────────────────────

const DOC_TYPES = [
  // Paystub
  'Paystub',
  // Banking
  'Checking Account', 'Savings Account', 'High-Yield Savings', 'Money Market Account',
  'Certificate of Deposit', 'Cash Management Account', 'Bank Statement',
  // Credit / Debt
  'Credit Card', 'Credit Card Statement', 'Line of Credit',
  'Auto Loan', 'Personal Loan', 'Mortgage', 'HELOC', 'Student Loan',
  // Brokerage
  'Brokerage Account', 'Margin Account', 'Robo-Adviser Account', 'Employee Stock Plan',
  // Retirement
  '401(k)', 'Roth 401(k)', '403(b)', '457(b)',
  'Traditional IRA', 'Roth IRA', 'SEP IRA', 'SIMPLE IRA', 'Rollover IRA',
  'Pension', 'Thrift Savings Plan', 'HSA Investment Account',
  // Legacy aliases kept for backward compat
  'Retirement Account', 'Retirement Statement', 'Investment Statement',
  // Bills
  'Monthly Bill', 'Utility Bill',
  'Unknown',
];

const DOC_TYPE_EMOJI: Record<string, string> = {
  'Paystub': '💵',
  'Checking Account': '🏦', 'Savings Account': '🏦', 'High-Yield Savings': '🏦',
  'Money Market Account': '🏦', 'Certificate of Deposit': '🏦',
  'Cash Management Account': '🏦', 'Bank Statement': '🏦',
  'Credit Card': '💳', 'Credit Card Statement': '💳', 'Line of Credit': '💳',
  'Auto Loan': '🚗', 'Personal Loan': '📋', 'Mortgage': '🏠',
  'HELOC': '🏠', 'Student Loan': '🎓',
  'Brokerage Account': '📈', 'Margin Account': '📈',
  'Robo-Adviser Account': '🤖', 'Employee Stock Plan': '📊',
  '401(k)': '🏦', 'Roth 401(k)': '🏦', '403(b)': '🏦', '457(b)': '🏦',
  'Traditional IRA': '🏦', 'Roth IRA': '🏦', 'SEP IRA': '🏦',
  'SIMPLE IRA': '🏦', 'Rollover IRA': '🏦',
  'Pension': '🏦', 'Thrift Savings Plan': '🏦', 'HSA Investment Account': '🏥',
  'Retirement Account': '🏦', 'Retirement Statement': '🏦', 'Investment Statement': '📈',
  'Monthly Bill': '📄', 'Utility Bill': '💡',
  'Unknown': '❓',
};

// ─── Fields per doc type ──────────────────────────────────────────────────────

const DOC_FIELDS: Record<string, Array<{ key: string; label: string; type?: string; prefix?: string }>> = {
  'Paystub': [
    { key: 'employer', label: 'Employer' },
    { key: 'payDate', label: 'Pay Date', type: 'date' },
    { key: 'hourlyRate', label: 'Hourly Rate', type: 'number', prefix: '$' },
    { key: 'regularHours', label: 'Regular Hours', type: 'number' },
    { key: 'overtimeHours', label: 'OT Hours (1.5×)', type: 'number' },
    { key: 'doubleTimeHours', label: 'DT Hours (2×)', type: 'number' },
    { key: 'perDiem', label: 'Per Diem', type: 'number', prefix: '$' },
    { key: 'standbyPay', label: 'Standby Pay', type: 'number', prefix: '$' },
    { key: 'bonus', label: 'Bonus', type: 'number', prefix: '$' },
    { key: 'grossPay', label: 'Gross Pay', type: 'number', prefix: '$' },
    { key: 'federalTax', label: 'Federal Tax', type: 'number', prefix: '$' },
    { key: 'stateTax', label: 'State Tax', type: 'number', prefix: '$' },
    { key: 'socialSecurity', label: 'Social Security', type: 'number', prefix: '$' },
    { key: 'medicare', label: 'Medicare', type: 'number', prefix: '$' },
    { key: 'unionDues', label: 'Union Dues', type: 'number', prefix: '$' },
    { key: 'insuranceDeductions', label: 'Insurance Deductions', type: 'number', prefix: '$' },
    { key: 'retirementContribution', label: 'Retirement Contribution', type: 'number', prefix: '$' },
    { key: 'retirementRate', label: 'Retirement Rate (%)', type: 'number' },
    { key: 'otherDeductions', label: 'Other Deductions', type: 'number', prefix: '$' },
    { key: 'netPay', label: 'Net Pay', type: 'number', prefix: '$' },
  ],
  'Checking Account': [
    { key: 'institution', label: 'Bank / Institution' },
    { key: 'accountName', label: 'Account Name' },
    { key: 'lastFour', label: 'Last 4 Digits' },
    { key: 'currentBalance', label: 'Current Balance', type: 'number', prefix: '$' },
    { key: 'availableBalance', label: 'Available Balance', type: 'number', prefix: '$' },
    { key: 'apy', label: 'APY (%)', type: 'number' },
  ],
  'Savings Account': [
    { key: 'institution', label: 'Bank / Institution' },
    { key: 'accountName', label: 'Account Name' },
    { key: 'lastFour', label: 'Last 4 Digits' },
    { key: 'currentBalance', label: 'Current Balance', type: 'number', prefix: '$' },
    { key: 'availableBalance', label: 'Available Balance', type: 'number', prefix: '$' },
    { key: 'apy', label: 'APY (%)', type: 'number' },
  ],
  'Bank Statement': [
    { key: 'institution', label: 'Bank / Institution' },
    { key: 'accountName', label: 'Account Name' },
    { key: 'lastFour', label: 'Last 4 Digits' },
    { key: 'closingBalance', label: 'Closing Balance', type: 'number', prefix: '$' },
    { key: 'statementStartDate', label: 'Statement Start', type: 'date' },
    { key: 'statementEndDate', label: 'Statement End', type: 'date' },
  ],
  'Credit Card': [
    { key: 'issuer', label: 'Issuer' },
    { key: 'accountName', label: 'Card Name' },
    { key: 'lastFour', label: 'Last 4 Digits' },
    { key: 'currentBalance', label: 'Current Balance', type: 'number', prefix: '$' },
    { key: 'creditLimit', label: 'Credit Limit', type: 'number', prefix: '$' },
    { key: 'availableCredit', label: 'Available Credit', type: 'number', prefix: '$' },
    { key: 'apr', label: 'APR (%)', type: 'number' },
    { key: 'minimumPayment', label: 'Min Payment', type: 'number', prefix: '$' },
    { key: 'dueDate', label: 'Due Date' },
  ],
  'Credit Card Statement': [
    { key: 'issuer', label: 'Issuer' },
    { key: 'accountName', label: 'Card Name' },
    { key: 'lastFour', label: 'Last 4 Digits' },
    { key: 'closingBalance', label: 'Statement Balance', type: 'number', prefix: '$' },
    { key: 'creditLimit', label: 'Credit Limit', type: 'number', prefix: '$' },
    { key: 'apr', label: 'APR (%)', type: 'number' },
    { key: 'minimumPayment', label: 'Min Payment', type: 'number', prefix: '$' },
    { key: 'dueDate', label: 'Due Date' },
  ],
  'Auto Loan': [
    { key: 'loanName', label: 'Lender / Loan Name' },
    { key: 'accountLast4', label: 'Last 4 Digits' },
    { key: 'balanceOwed', label: 'Balance Owed', type: 'number', prefix: '$' },
    { key: 'originalAmount', label: 'Original Amount', type: 'number', prefix: '$' },
    { key: 'apr', label: 'APR (%)', type: 'number' },
    { key: 'monthlyPayment', label: 'Monthly Payment', type: 'number', prefix: '$' },
    { key: 'monthsRemaining', label: 'Months Remaining', type: 'number' },
    { key: 'nextDueDate', label: 'Next Due Date' },
  ],
  'Personal Loan': [
    { key: 'lender', label: 'Lender' },
    { key: 'loanName', label: 'Loan Name' },
    { key: 'currentBalance', label: 'Balance Owed', type: 'number', prefix: '$' },
    { key: 'apr', label: 'APR (%)', type: 'number' },
    { key: 'monthlyPayment', label: 'Monthly Payment', type: 'number', prefix: '$' },
    { key: 'remainingTermMonths', label: 'Months Remaining', type: 'number' },
    { key: 'nextDueDate', label: 'Next Due Date' },
  ],
  'Mortgage': [
    { key: 'lender', label: 'Lender' },
    { key: 'propertyAddress', label: 'Property Address' },
    { key: 'principalBalance', label: 'Principal Balance', type: 'number', prefix: '$' },
    { key: 'originalLoanAmount', label: 'Original Loan Amount', type: 'number', prefix: '$' },
    { key: 'interestRate', label: 'Interest Rate (%)', type: 'number' },
    { key: 'monthlyPayment', label: 'Monthly Payment', type: 'number', prefix: '$' },
    { key: 'escrowAmount', label: 'Escrow', type: 'number', prefix: '$' },
    { key: 'propertyValue', label: 'Property Value', type: 'number', prefix: '$' },
    { key: 'nextDueDate', label: 'Next Due Date' },
  ],
  'Brokerage Account': [
    { key: 'institution', label: 'Institution' },
    { key: 'accountType', label: 'Account Type' },
    { key: 'totalValue', label: 'Total Value', type: 'number', prefix: '$' },
    { key: 'cashBalance', label: 'Cash Balance', type: 'number', prefix: '$' },
    { key: 'dailyReturn', label: 'Daily Return', type: 'number', prefix: '$' },
    { key: 'totalReturn', label: 'Total Return', type: 'number', prefix: '$' },
  ],
  'Investment Statement': [
    { key: 'institution', label: 'Institution' },
    { key: 'accountType', label: 'Account Type' },
    { key: 'totalValue', label: 'Total Value', type: 'number', prefix: '$' },
  ],
  'Retirement Account': [
    { key: 'institution', label: 'Institution' },
    { key: 'accountType', label: 'Account Type (401k, IRA, etc.)' },
    { key: 'currentBalance', label: 'Current Balance', type: 'number', prefix: '$' },
    { key: 'employeeContributionRate', label: 'My Contribution Rate (%)', type: 'number' },
    { key: 'employerMatchRate', label: 'Employer Match Rate (%)', type: 'number' },
    { key: 'ytdContributions', label: 'YTD Contributions', type: 'number', prefix: '$' },
  ],
  'Retirement Statement': [
    { key: 'institution', label: 'Institution' },
    { key: 'accountType', label: 'Account Type' },
    { key: 'currentBalance', label: 'Current Balance', type: 'number', prefix: '$' },
    { key: 'employeeContributionRate', label: 'My Contribution Rate (%)', type: 'number' },
    { key: 'ytdContributions', label: 'YTD Contributions', type: 'number', prefix: '$' },
  ],
  'Monthly Bill': [
    { key: 'provider', label: 'Provider' },
    { key: 'category', label: 'Category' },
    { key: 'amountDue', label: 'Amount Due', type: 'number', prefix: '$' },
    { key: 'dueDate', label: 'Due Date (day of month)', type: 'number' },
    { key: 'autopay', label: 'AutoPay?' },
  ],
  'Utility Bill': [
    { key: 'provider', label: 'Provider' },
    { key: 'category', label: 'Category (Electric, Gas, etc.)' },
    { key: 'amountDue', label: 'Amount Due', type: 'number', prefix: '$' },
    { key: 'dueDate', label: 'Due Date (day of month)', type: 'number' },
    { key: 'autopay', label: 'AutoPay?' },
  ],
};
DOC_FIELDS['Unknown'] = [];

// ── New banking types ──────────────────────────────────────────────────────
DOC_FIELDS['High-Yield Savings'] = DOC_FIELDS['Savings Account'];
DOC_FIELDS['Money Market Account'] = DOC_FIELDS['Savings Account'];
DOC_FIELDS['Cash Management Account'] = DOC_FIELDS['Checking Account'];
DOC_FIELDS['Certificate of Deposit'] = [
  ...DOC_FIELDS['Savings Account'],
  { key: 'maturityDate', label: 'Maturity Date', type: 'date' },
  { key: 'termMonths', label: 'Term (months)', type: 'number' },
  { key: 'penaltyForEarlyWithdrawal', label: 'Early Withdrawal Penalty', type: 'number', prefix: '$' },
];

// ── New credit / debt types ────────────────────────────────────────────────
DOC_FIELDS['Line of Credit'] = [
  { key: 'lender', label: 'Lender' },
  { key: 'accountName', label: 'Account Name' },
  { key: 'lastFour', label: 'Last 4 Digits' },
  { key: 'creditLimit', label: 'Credit Limit', type: 'number', prefix: '$' },
  { key: 'currentBalance', label: 'Balance Used', type: 'number', prefix: '$' },
  { key: 'availableCredit', label: 'Available Credit', type: 'number', prefix: '$' },
  { key: 'apr', label: 'APR (%)', type: 'number' },
  { key: 'minimumPayment', label: 'Min Payment', type: 'number', prefix: '$' },
  { key: 'dueDate', label: 'Due Date' },
];
DOC_FIELDS['HELOC'] = [
  { key: 'lender', label: 'Lender' },
  { key: 'creditLimit', label: 'Credit Limit', type: 'number', prefix: '$' },
  { key: 'currentBalance', label: 'Balance Drawn', type: 'number', prefix: '$' },
  { key: 'availableCredit', label: 'Available Credit', type: 'number', prefix: '$' },
  { key: 'interestRate', label: 'Interest Rate (%)', type: 'number' },
  { key: 'monthlyPayment', label: 'Monthly Payment', type: 'number', prefix: '$' },
  { key: 'drawPeriodEnd', label: 'Draw Period End', type: 'date' },
];
DOC_FIELDS['Student Loan'] = [
  { key: 'servicer', label: 'Loan Servicer' },
  { key: 'loanType', label: 'Loan Type' },
  { key: 'currentBalance', label: 'Balance Owed', type: 'number', prefix: '$' },
  { key: 'originalAmount', label: 'Original Amount', type: 'number', prefix: '$' },
  { key: 'interestRate', label: 'Interest Rate (%)', type: 'number' },
  { key: 'monthlyPayment', label: 'Monthly Payment', type: 'number', prefix: '$' },
  { key: 'remainingTermMonths', label: 'Months Remaining', type: 'number' },
  { key: 'repaymentPlan', label: 'Repayment Plan' },
  { key: 'nextDueDate', label: 'Next Due Date' },
];

// ── New brokerage types ────────────────────────────────────────────────────
const BROKERAGE_FIELDS = [
  { key: 'institution', label: 'Institution' },
  { key: 'accountType', label: 'Account Type' },
  { key: 'lastFour', label: 'Last 4 Digits' },
  { key: 'totalValue', label: 'Total Value', type: 'number', prefix: '$' },
  { key: 'securitiesValue', label: 'Securities Value', type: 'number', prefix: '$' },
  { key: 'cashBalance', label: 'Cash / Uninvested', type: 'number', prefix: '$' },
  { key: 'buyingPower', label: 'Buying Power', type: 'number', prefix: '$' },
  { key: 'unrealizedGain', label: 'Unrealized Gain/Loss', type: 'number', prefix: '$' },
  { key: 'totalReturn', label: 'Total Return', type: 'number', prefix: '$' },
  { key: 'statementDate', label: 'Statement Date', type: 'date' },
];
DOC_FIELDS['Robo-Adviser Account'] = BROKERAGE_FIELDS;
DOC_FIELDS['Margin Account'] = [
  ...BROKERAGE_FIELDS,
  { key: 'marginBalance', label: 'Margin Balance', type: 'number', prefix: '$' },
  { key: 'marginAvailable', label: 'Margin Available', type: 'number', prefix: '$' },
  { key: 'marginInterestRate', label: 'Margin Rate (%)', type: 'number' },
];
DOC_FIELDS['Employee Stock Plan'] = [
  { key: 'institution', label: 'Administrator' },
  { key: 'employer', label: 'Employer' },
  { key: 'planType', label: 'Plan Type (ESPP, RSU, ISO…)' },
  { key: 'totalValue', label: 'Total Value', type: 'number', prefix: '$' },
  { key: 'vestedValue', label: 'Vested Value', type: 'number', prefix: '$' },
  { key: 'unvestedValue', label: 'Unvested Value', type: 'number', prefix: '$' },
  { key: 'sharesVested', label: 'Vested Shares', type: 'number' },
  { key: 'statementDate', label: 'Statement Date', type: 'date' },
];

// ── Retirement types — full detail ─────────────────────────────────────────
const RETIREMENT_FIELDS_FULL = [
  { key: 'institution', label: 'Provider / Administrator' },
  { key: 'employer', label: 'Employer / Plan Sponsor' },
  { key: 'planName', label: 'Plan Name' },
  { key: 'lastFour', label: 'Last 4 Digits' },
  { key: 'currentBalance', label: 'Total Balance', type: 'number', prefix: '$' },
  { key: 'vestedBalance', label: 'Vested Balance', type: 'number', prefix: '$' },
  { key: 'employeeContributionRate', label: 'My Contribution (%)', type: 'number' },
  { key: 'rothContributionRate', label: 'Roth Contribution (%)', type: 'number' },
  { key: 'employerMatchRate', label: 'Employer Match (%)', type: 'number' },
  { key: 'employerMatchFormula', label: 'Match Formula' },
  { key: 'employerMatchAmount', label: 'Employer Match $', type: 'number', prefix: '$' },
  { key: 'employeeYtdContributions', label: 'My YTD Contributions', type: 'number', prefix: '$' },
  { key: 'employerYtdContributions', label: 'Employer YTD Contributions', type: 'number', prefix: '$' },
  { key: 'vestingPercent', label: 'Vesting %', type: 'number' },
  { key: 'outstandingLoanBalance', label: 'Plan Loan Balance', type: 'number', prefix: '$' },
  { key: 'statementDate', label: 'Statement Date', type: 'date' },
];
const IRA_FIELDS = [
  { key: 'institution', label: 'Custodian' },
  { key: 'accountType', label: 'Account Type' },
  { key: 'lastFour', label: 'Last 4 Digits' },
  { key: 'currentBalance', label: 'Total Balance', type: 'number', prefix: '$' },
  { key: 'ytdContributions', label: 'YTD Contributions', type: 'number', prefix: '$' },
  { key: 'contributionLimit', label: 'Annual Limit', type: 'number', prefix: '$' },
  { key: 'statementDate', label: 'Statement Date', type: 'date' },
];

DOC_FIELDS['401(k)'] = RETIREMENT_FIELDS_FULL;
DOC_FIELDS['Roth 401(k)'] = RETIREMENT_FIELDS_FULL;
DOC_FIELDS['403(b)'] = RETIREMENT_FIELDS_FULL;
DOC_FIELDS['457(b)'] = RETIREMENT_FIELDS_FULL;
DOC_FIELDS['Thrift Savings Plan'] = RETIREMENT_FIELDS_FULL;
DOC_FIELDS['Traditional IRA'] = IRA_FIELDS;
DOC_FIELDS['Roth IRA'] = IRA_FIELDS;
DOC_FIELDS['SEP IRA'] = IRA_FIELDS;
DOC_FIELDS['SIMPLE IRA'] = IRA_FIELDS;
DOC_FIELDS['Rollover IRA'] = IRA_FIELDS;
DOC_FIELDS['Pension'] = [
  { key: 'institution', label: 'Plan Administrator' },
  { key: 'employer', label: 'Employer' },
  { key: 'planName', label: 'Plan Name' },
  { key: 'monthlyBenefit', label: 'Monthly Benefit', type: 'number', prefix: '$' },
  { key: 'vestedBenefit', label: 'Vested Benefit', type: 'number', prefix: '$' },
  { key: 'yearsOfService', label: 'Years of Service', type: 'number' },
  { key: 'retirementAge', label: 'Retirement Age', type: 'number' },
  { key: 'statementDate', label: 'Statement Date', type: 'date' },
];
DOC_FIELDS['HSA Investment Account'] = [
  { key: 'institution', label: 'HSA Provider' },
  { key: 'currentBalance', label: 'Total Balance', type: 'number', prefix: '$' },
  { key: 'investedBalance', label: 'Invested Balance', type: 'number', prefix: '$' },
  { key: 'cashBalance', label: 'Cash Balance', type: 'number', prefix: '$' },
  { key: 'ytdContributions', label: 'YTD Contributions', type: 'number', prefix: '$' },
  { key: 'contributionLimit', label: 'Annual Limit', type: 'number', prefix: '$' },
  { key: 'statementDate', label: 'Statement Date', type: 'date' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ConfidenceBadge({ score }: { score: number }) {
  const cls = score >= 85 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
    : score >= 60 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
    : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cls}`}>{score}%</span>;
}

function ConfidenceDot({ score }: { score: number }) {
  const cls = score >= 85 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-400' : 'bg-slate-400';
  return <span className={`inline-block w-2 h-2 rounded-full ${cls} flex-shrink-0`} title={`${score}% confidence`} />;
}

// ─── Batch constants ──────────────────────────────────────────────────────────

const MAX_BATCH_FILES = 20;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const SCAN_CONCURRENCY = 2;

// ─── Types ────────────────────────────────────────────────────────────────────

type BatchDocumentStatus = 'pending' | 'processing' | 'retrying' | 'done' | 'error';

interface BatchDocument {
  id: string;
  file: File;
  preview: string;
  fingerprint?: string;
  status: BatchDocumentStatus;
  docType: string;
  fields: Record<string, { value: string; confidence: number }>;
  result?: ScanResult;
  error?: string;
  errorStage?: string;
  retryAttempt?: number;
  retryWaitMs?: number;
  accepted: boolean;
  isDuplicate: boolean;
  institutionName: string;
  institutionUnknown: boolean;
  institutionCategory: string | null;
}

type Step = 'upload' | 'processing' | 'review' | 'done';

// ─── Module-level helpers ─────────────────────────────────────────────────────

/** Normalise a null / primitive / wrapped AI field value to a consistent shape. */
function getFieldValue(raw: unknown): { value: string | null; confidence: number } {
  if (raw == null) return { value: null, confidence: 0 };
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return { value: String(raw), confidence: 70 };
  }
  if (typeof raw === 'object' && 'value' in (raw as object)) {
    const obj = raw as { value?: unknown; confidence?: unknown };
    const v = obj.value;
    return {
      value: v != null ? String(v) : null,
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 70,
    };
  }
  return { value: null, confidence: 0 };
}

/** Parse a structured JSON API error into stage + message. */
function parseApiError(err: unknown): { stage: string; message: string } {
  if (err instanceof Error) {
    try {
      const parsed = JSON.parse(err.message);
      return { stage: parsed.stage ?? 'unknown', message: parsed.message ?? err.message };
    } catch {
      return { stage: 'unknown', message: err.message };
    }
  }
  return { stage: 'unknown', message: String(err) };
}

/**
 * Merge incoming files into the current list, deduplicating by name+size+mtime.
 * Hard-caps the result at MAX_BATCH_FILES.
 */
function mergeUniqueFiles(current: File[], incoming: File[]): File[] {
  const seen = new Set(current.map(f => `${f.name}:${f.size}:${f.lastModified}`));
  const merged = [...current];
  for (const file of incoming) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(file);
    }
  }
  return merged.slice(0, MAX_BATCH_FILES);
}

// ─── Rate-limit retry helpers ─────────────────────────────────────────────────

/** Exponential back-off delays (ms): 2 s, 4 s, 8 s. */
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const;
const MAX_RATE_LIMIT_RETRIES = 3;
/** Retry delays are clamped to this window so a bad Retry-After can't stall the batch. */
const CLAMP_MIN_MS = 1_000;
const CLAMP_MAX_MS = 30_000;

function clampRetryMs(ms: number): number {
  return Math.max(CLAMP_MIN_MS, Math.min(CLAMP_MAX_MS, Math.round(ms)));
}

/**
 * Detect whether `err` represents an HTTP 429 / rate-limit response and
 * return the raw retry-hint values.  Returns null for all other errors.
 */
function is429Error(err: unknown): {
  retryAfterHeader: string | null;
  retryAfterBodyMs: number | undefined;
} | null {
  if (!(err instanceof Error)) return null;
  try {
    const parsed = JSON.parse(err.message) as Record<string, unknown>;
    const status = parsed.httpStatus;
    const msg = typeof parsed.message === 'string' ? parsed.message.toLowerCase() : '';
    if (status === 429 || msg.includes('too many requests') || msg.includes('rate limit')) {
      return {
        retryAfterHeader:
          typeof parsed.retryAfterHeader === 'string' ? parsed.retryAfterHeader : null,
        retryAfterBodyMs:
          typeof parsed.retryAfterBodyMs === 'number' ? parsed.retryAfterBodyMs : undefined,
      };
    }
  } catch { /* not JSON — fall through to raw-string check */ }
  const raw = err.message.toLowerCase();
  if (raw.includes('429') || raw.includes('too many requests') || raw.includes('rate limit')) {
    return { retryAfterHeader: null, retryAfterBodyMs: undefined };
  }
  return null;
}

/**
 * Compute the retry wait in milliseconds, clamped to [CLAMP_MIN_MS, CLAMP_MAX_MS].
 *
 * Priority:
 * 1. retryAfterBodyMs  — milliseconds from the JSON body
 * 2. retryAfterHeader  as a numeric second count
 * 3. retryAfterHeader  as an HTTP-date string
 * 4. Exponential back-off from RETRY_DELAYS_MS
 *
 * @param attempt  0-indexed attempt count, used to index RETRY_DELAYS_MS.
 */
function parseRetryDelay(
  retryAfterHeader: string | null,
  retryAfterBodyMs: number | undefined,
  attempt: number,
): number {
  // 1. Body milliseconds
  if (retryAfterBodyMs !== undefined && retryAfterBodyMs > 0) {
    return clampRetryMs(retryAfterBodyMs);
  }

  if (retryAfterHeader) {
    // 2. Numeric seconds ("5", "30", "1550", …)
    const trimmed = retryAfterHeader.trim();
    const numSec = Number(trimmed);
    if (!isNaN(numSec) && trimmed !== '') {
      return clampRetryMs(numSec * 1_000);
    }

    // 3. HTTP-date (e.g. "Thu, 04 Aug 2026 19:00:00 GMT")
    const dateMs = new Date(retryAfterHeader).getTime();
    if (!isNaN(dateMs)) {
      return clampRetryMs(dateMs - Date.now());
    }
  }

  // 4. Exponential back-off
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

/**
 * Normalise a ScanResult from any server fast-path or generic shape into the
 * fields the UI and financial store need.
 */
function normalizeScanResult(result: ScanResult): {
  resolvedDocType: string;
  fieldMap: Record<string, { value: string; confidence: number }>;
  institutionName: string;
  institutionUnknown: boolean;
  institutionCategory: string | null;
} {
  const r = result as any;
  const isVehicleLoan = r.type === 'vehicleLoan' || r.documentType === 'vehicleLoan';
  const isBankStatement = r.type === 'bankStatement' || r.documentType === 'bankStatement';

  function resolveFlatData(res: any): Record<string, unknown> | null {
    const d = res?.data?.data ?? res?.data?.extraction ?? res?.data?.result ??
              res?.data ?? res?.extraction ?? res?.result;
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
  }

  function flatToFieldMap(
    extracted: Record<string, unknown>,
    keys: string[],
    conf = 80,
  ): Record<string, { value: string; confidence: number }> {
    const map: Record<string, { value: string; confidence: number }> = {};
    for (const key of keys) {
      const val = extracted[key];
      if (val !== null && val !== undefined) map[key] = { value: String(val), confidence: conf };
    }
    return map;
  }

  const fieldMap: Record<string, { value: string; confidence: number }> = {};

  if (isVehicleLoan) {
    const extracted = resolveFlatData(r);
    if (!extracted) throw new Error('The document processor returned an unrecognized response format.');
    Object.assign(fieldMap, flatToFieldMap(extracted, [
      'loanName', 'accountLast4', 'balanceOwed', 'originalAmount',
      'apr', 'monthlyPayment', 'monthsRemaining', 'nextDueDate',
    ]));
  } else if (isBankStatement) {
    const extracted = resolveFlatData(r);
    if (!extracted) throw new Error('The document processor returned an unrecognized response format.');
    Object.assign(fieldMap, flatToFieldMap(extracted, [
      'institution', 'accountName', 'lastFour',
      'closingBalance', 'currentBalance', 'availableBalance',
      'statementStartDate', 'statementEndDate', 'apy',
    ]));
  } else {
    for (const [k, v] of Object.entries(result.fields ?? {})) {
      const { value, confidence } = getFieldValue(v);
      if (value != null) fieldMap[k] = { value, confidence };
    }
  }

  const inst = result.institution;
  const fastPathInstitution =
    isVehicleLoan ? (r.data?.loanName ?? '') :
    isBankStatement ? (r.data?.institution ?? '') : '';
  const institutionName = inst?.normalizedName || inst?.rawName || fastPathInstitution || '';
  const institutionUnknown = !inst?.isKnownInstitution && !!institutionName;
  const institutionCategory = inst?.institutionCategory ?? null;
  const resolvedDocType =
    isVehicleLoan ? 'Auto Loan' :
    isBankStatement ? 'Bank Statement' :
    (result.docType ?? 'Unknown');

  return { resolvedDocType, fieldMap, institutionName, institutionUnknown, institutionCategory };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Scanner() {
  const [_, setLocation] = useLocation();
  const { getToken } = useAuth();
  const store = useStore();
  const {
    updateProfile, addPaystub, addDebt, addBill, addAsset,
    updateAsset, updateDebt, updateBill, addChangeRecords, undoImport,
    assets, debts, bills, documents,
    profile,
  } = store;
  const { enqueue, updateJob } = useJobQueue();

  const [step, setStep] = useState<Step>('upload');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [docs, setDocs] = useState<BatchDocument[]>([]);
  const [userName, setUserName] = useState(profile?.name ?? '');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [globalError, setGlobalError] = useState('');
  // Smart-update state
  const [updatePlan, setUpdatePlan] = useState<UpdatePlan | null>(null);
  const [matchChoices, setMatchChoices] = useState<Record<string, MatchChoice>>({});
  const [lastImportDocId, setLastImportDocId] = useState<string | null>(null);

  // ── Refs: preview cleanup, queue management, lifecycle ────────────────────

  const previewsRef      = useRef<string[]>([]);
  const docsRef          = useRef<BatchDocument[]>([]);
  /** IDs waiting for a free slot. */
  const queueRef         = useRef<string[]>([]);
  /** Number of API calls in flight right now (0–SCAN_CONCURRENCY). */
  const activeCountRef   = useRef(0);
  /** Per-doc retry setTimeout handles — cancelled on remove / reset / unmount. */
  const retryTimersRef   = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Per-doc retry attempt count — reset when user manually retries. */
  const retryAttemptsRef = useRef(new Map<string, number>());
  /**
   * Stable pointer to the latest render's dispatchNext so setTimeout callbacks
   * always call the up-to-date version without capturing a stale closure.
   */
  const dispatchNextRef  = useRef<() => void>(() => {});
  const isMountedRef     = useRef(true);

  useEffect(() => { previewsRef.current = previews; }, [previews]);
  useEffect(() => { docsRef.current = docs; }, [docs]);

  // Cancel all retry timers and revoke object URLs on unmount.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      retryTimersRef.current.forEach(t => clearTimeout(t));
      retryTimersRef.current.clear();
      previewsRef.current.forEach(url => { if (url) try { URL.revokeObjectURL(url); } catch {} });
      docsRef.current.forEach(doc => { if (doc.preview) try { URL.revokeObjectURL(doc.preview); } catch {} });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Advance to the review step automatically once every doc reaches a terminal
  // state (done or error).  The queue dispatcher does NOT call setStep directly
  // so that retrying docs (with pending timers) don't prematurely flip the step.
  useEffect(() => {
    if (step !== 'processing' || docs.length === 0) return;
    if (docs.every(d => d.status === 'done' || d.status === 'error')) {
      setStep('review');
    }
  }, [docs, step]);

  // ── Progress counts (derived from docs state) ──────────────────────────────

  const totalCount      = docs.length;
  const completedCount  = docs.filter(d => d.status === 'done').length;
  const failedCount     = docs.filter(d => d.status === 'error').length;
  const processingCount = docs.filter(d => d.status === 'processing').length;
  const retryingCount   = docs.filter(d => d.status === 'retrying').length;
  const pendingCount    = docs.filter(d => d.status === 'pending').length;
  const finishedCount   = completedCount + failedCount;
  const activeCount     = processingCount + retryingCount + pendingCount;

  /** Documents that are confirmed-done AND accepted — the set the store will receive. */
  const savableDocuments = docs.filter(d => d.status === 'done' && d.accepted);

  // ── File handling ──────────────────────────────────────────────────────────

  const addFiles = useCallback((newFiles: File[]) => {
    const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i;

    // Accept files by MIME or extension (iOS Safari often has empty MIME type)
    const typeValid = newFiles.filter(f =>
      f.type.startsWith('image/') ||
      f.type === 'application/pdf' ||
      IMAGE_EXT.test(f.name) ||
      /\.pdf$/i.test(f.name)
    );

    const oversized = typeValid.filter(f => f.size > MAX_FILE_BYTES);
    const sizeValid  = typeValid.filter(f => f.size <= MAX_FILE_BYTES);

    if (oversized.length > 0) {
      setGlobalError(
        `${oversized.length} file${oversized.length !== 1 ? 's' : ''} exceed the 10 MB limit and were not added.`,
      );
    }

    // Generate preview URLs OUTSIDE the state updater (React 18 Strict Mode
    // double-invokes updaters in dev, which would create duplicate object URLs).
    const newPreviews = sizeValid.map(f => {
      try {
        if (f.type.startsWith('image/') || IMAGE_EXT.test(f.name)) return URL.createObjectURL(f);
      } catch {}
      return '';
    });

    setFiles(prev => {
      const merged = mergeUniqueFiles(prev, sizeValid);
      if (sizeValid.length > 0 && prev.length + sizeValid.length > MAX_BATCH_FILES && merged.length === MAX_BATCH_FILES) {
        setTimeout(() => setGlobalError(e => e || `Batch limit of ${MAX_BATCH_FILES} files reached.`), 0);
      }
      return merged;
    });
    setPreviews(prev => [...prev, ...newPreviews].slice(0, MAX_BATCH_FILES));
  }, []);

  const removeFile = (i: number) => {
    const url = previews[i];
    if (url) try { URL.revokeObjectURL(url); } catch {}
    setFiles(prev => prev.filter((_, idx) => idx !== i));
    setPreviews(prev => prev.filter((_, idx) => idx !== i));
  };

  // ── Concurrency-limited queue processor ───────────────────────────────────
  //
  // dispatchNext() and runOneScan() are plain function declarations so they are
  // hoisted and can reference each other.  dispatchNextRef.current is updated
  // on every render so setTimeout callbacks always call the latest closure.
  //
  // Key invariant: a retrying doc RELEASES its slot before its timer fires, so
  // another queued doc can start immediately rather than waiting out the delay.

  function dispatchNext(): void {
    if (!isMountedRef.current) return;
    while (activeCountRef.current < SCAN_CONCURRENCY && queueRef.current.length > 0) {
      const docId = queueRef.current.shift()!;
      activeCountRef.current++;
      // .finally() releases the slot unconditionally — success, fatal error,
      // AND the 429-release path all flow through here.
      runOneScan(docId).finally(() => {
        activeCountRef.current--;
        dispatchNextRef.current();
      });
    }
  }
  dispatchNextRef.current = dispatchNext;

  async function runOneScan(docId: string): Promise<void> {
    if (!isMountedRef.current) return;
    const doc = docsRef.current.find(d => d.id === docId);
    if (!doc) return; // Doc was removed while waiting in the queue

    setDocs(prev => prev.map(d =>
      d.id === docId
        ? { ...d, status: 'processing', error: undefined, errorStage: undefined,
            retryAttempt: undefined, retryWaitMs: undefined }
        : d,
    ));

    try {
      const token = await getToken().catch(() => null);
      if (!isMountedRef.current) return;
      const result = await scanFile(doc.file, token);
      if (!isMountedRef.current) return;

      const {
        resolvedDocType, fieldMap,
        institutionName, institutionUnknown, institutionCategory,
      } = normalizeScanResult(result);

      setDocs(prev => prev.map(d =>
        d.id === docId
          ? {
              ...d,
              status: 'done',
              result,
              docType: resolvedDocType,
              fields: fieldMap,
              institutionName,
              institutionUnknown,
              institutionCategory,
              accepted: true,
              error: undefined,
              errorStage: undefined,
              retryAttempt: undefined,
              retryWaitMs: undefined,
            }
          : d,
      ));
    } catch (err) {
      if (!isMountedRef.current) return;
      const rl = is429Error(err);
      const attempts = retryAttemptsRef.current.get(docId) ?? 0;

      if (rl !== null && attempts < MAX_RATE_LIMIT_RETRIES) {
        // ── Rate-limited: release this slot NOW, re-queue after delay ──────
        const waitMs = parseRetryDelay(rl.retryAfterHeader, rl.retryAfterBodyMs, attempts);
        retryAttemptsRef.current.set(docId, attempts + 1);

        setDocs(prev => prev.map(d =>
          d.id === docId
            ? { ...d, status: 'retrying', retryAttempt: attempts + 1, retryWaitMs: waitMs }
            : d,
        ));

        // Guard against duplicate timers for the same doc.
        const stale = retryTimersRef.current.get(docId);
        if (stale !== undefined) clearTimeout(stale);

        const timer = setTimeout(() => {
          if (!isMountedRef.current) return;
          retryTimersRef.current.delete(docId);
          queueRef.current.unshift(docId); // front — retry ASAP
          dispatchNextRef.current();
        }, waitMs);
        retryTimersRef.current.set(docId, timer);

        // Return normally so .finally() in dispatchNext frees the active slot.
        return;
      }

      // Non-429 or all retries exhausted — terminal failure.
      const { stage, message } = parseApiError(err);
      setDocs(prev => prev.map(d =>
        d.id === docId
          ? {
              ...d,
              status: 'error',
              error: message,
              errorStage: stage,
              docType: 'Unknown',
              fields: {},
              accepted: false,
              retryAttempt: undefined,
              retryWaitMs: undefined,
            }
          : d,
      ));
    }
  }

  // ── Start processing ───────────────────────────────────────────────────────

  const startProcessing = async () => {
    if (files.length === 0) return;
    setStep('processing');
    setGlobalError('');

    const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i;

    // Revoke upload-step preview URLs — new ones are created per-doc below.
    previews.forEach(url => { if (url) try { URL.revokeObjectURL(url); } catch {} });
    setPreviews([]);

    // Create the initial batch docs with per-doc preview URLs.
    const initialDocs = await Promise.all(
      files.map(async (file) => {
        let preview = '';
        try {
          if (file.type.startsWith('image/') || IMAGE_EXT.test(file.name)) {
            preview = URL.createObjectURL(file);
          }
        } catch { preview = ''; }

        let fingerprint: string | undefined;
        try { fingerprint = await fingerprintFile(file); }
        catch { fingerprint = undefined; }

        return {
          id: crypto.randomUUID(),
          file,
          preview,
          fingerprint,
          status: 'pending' as const,
          docType: 'Unknown',
          fields: {},
          accepted: true,
          isDuplicate: false,
          institutionName: '',
          institutionUnknown: false,
          institutionCategory: null,
        };
      }),
    );

    // Detect duplicates within the batch (same fingerprint appears 2+ times)
    // and against already-saved documents.
    const fingerprintCounts = new Map<string, number>();
    for (const doc of initialDocs) {
      if (!doc.fingerprint) continue;
      fingerprintCounts.set(doc.fingerprint, (fingerprintCounts.get(doc.fingerprint) ?? 0) + 1);
    }
    const existingFingerprints = new Set(
      documents.map(d => d.fingerprint).filter((fp): fp is string => Boolean(fp)),
    );

    const preparedDocs = initialDocs.map(doc => ({
      ...doc,
      isDuplicate:
        Boolean(doc.fingerprint) &&
        (existingFingerprints.has(doc.fingerprint!) ||
         (fingerprintCounts.get(doc.fingerprint!) ?? 0) > 1),
    }));

    // Mark duplicates as errors immediately; only queue the rest.
    const docsWithDupErrors = preparedDocs.map(doc =>
      doc.isDuplicate
        ? {
            ...doc,
            status: 'error' as const,
            accepted: false,
            errorStage: 'duplicate_document',
            error: 'This document appears to be a duplicate of one you have already imported.',
          }
        : doc,
    );

    // Reset all queue state from any previous batch.
    retryTimersRef.current.forEach(t => clearTimeout(t));
    retryTimersRef.current.clear();
    retryAttemptsRef.current.clear();
    activeCountRef.current = 0;

    setDocs(docsWithDupErrors);
    queueRef.current = docsWithDupErrors
      .filter(d => d.status === 'pending')
      .map(d => d.id);

    dispatchNext();
    // Step transition to 'review' is handled by the batch-completion useEffect.
  };

  // ── Retry a failed doc ─────────────────────────────────────────────────────

  const retryDoc = (docId: string) => {
    // Cancel any pending retry timer so we don't get a duplicate scan.
    const existing = retryTimersRef.current.get(docId);
    if (existing !== undefined) {
      clearTimeout(existing);
      retryTimersRef.current.delete(docId);
    }
    // Clear attempt count — this is a fresh user-initiated retry.
    retryAttemptsRef.current.delete(docId);

    setDocs(prev => prev.map(d =>
      d.id === docId
        ? { ...d, status: 'pending', accepted: true, isDuplicate: false,
            error: undefined, errorStage: undefined,
            retryAttempt: undefined, retryWaitMs: undefined }
        : d,
    ));

    queueRef.current.push(docId);
    dispatchNext();
  };

  // ── Remove a doc from the list ─────────────────────────────────────────────

  const removeDoc = (docId: string) => {
    // Cancel any pending retry timer and scrub from the queue.
    const existing = retryTimersRef.current.get(docId);
    if (existing !== undefined) {
      clearTimeout(existing);
      retryTimersRef.current.delete(docId);
    }
    retryAttemptsRef.current.delete(docId);
    queueRef.current = queueRef.current.filter(id => id !== docId);

    setDocs(prev => {
      const removed = prev.find(d => d.id === docId);
      if (removed?.preview) try { URL.revokeObjectURL(removed.preview); } catch {}
      return prev.filter(d => d.id !== docId);
    });
  };

  // ── Field update ───────────────────────────────────────────────────────────

  const updateField = (docId: string, key: string, value: string) => {
    setDocs(prev => prev.map(d => d.id === docId
      ? { ...d, fields: { ...d.fields, [key]: { value, confidence: d.fields[key]?.confidence ?? 90 } } }
      : d
    ));
  };

  const updateDocType = (docId: string, docType: string) => {
    setDocs(prev => prev.map(d => d.id === docId ? { ...d, docType } : d));
  };

  const updateInstitution = (docId: string, name: string) => {
    setDocs(prev => prev.map(d => d.id === docId ? { ...d, institutionName: name } : d));
  };

  // Save an unrecognized institution to localStorage for future reference
  const saveCustomInstitution = (rawName: string, canonicalName: string) => {
    try {
      const key = 'bcf_custom_institutions';
      const existing: Array<{ rawName: string; canonicalName: string; savedAt: string }> =
        JSON.parse(localStorage.getItem(key) ?? '[]');
      if (!existing.find(e => e.rawName === rawName)) {
        existing.push({ rawName, canonicalName, savedAt: new Date().toISOString() });
        localStorage.setItem(key, JSON.stringify(existing));
      }
    } catch { /* localStorage unavailable */ }
  };

  const toggleAccepted = (docId: string) => {
    setDocs(prev => prev.map(d => d.id === docId ? { ...d, accepted: !d.accepted } : d));
  };

  // ── Confirm & save (smart two-phase) ──────────────────────────────────────

  /** Phase 2: apply the resolved plan, record changes, advance to done */
  const doApplyPlan = useCallback((plan: UpdatePlan, choices: Record<string, MatchChoice>) => {
    const changeRecords = applyUpdatePlan(plan, choices, {
      addPaystub,
      updateAsset,
      addAsset,
      updateDebt,
      addDebt,
      updateBill,
      addBill,
    });
    if (changeRecords.length > 0) {
      addChangeRecords(changeRecords);
      setLastImportDocId(plan.sourceDocumentId);
    }
    setUpdatePlan(null);
    setStep('done');
  }, [addPaystub, updateAsset, addAsset, updateDebt, addDebt, updateBill, addBill, addChangeRecords]);

  /** Phase 1 (legacy path): called when there's no smart-update plan.
   *  Falls through to doApplyPlan immediately when no matches exist. */
  const confirmAndSave = () => {
    // Profile
    if (userName.trim()) {
      updateProfile({
        name: userName.trim(),
        hasCompletedOnboarding: true,
        payFrequency: profile?.payFrequency ?? 'Weekly',
        hourlyRate: profile?.hourlyRate ?? 0,
        filingContext: profile?.filingContext ?? 'Single',
      });
    }

    // If we're already showing a resolved plan, apply it
    if (updatePlan) {
      doApplyPlan(updatePlan, matchChoices);
      return;
    }

    // Build update plan from accepted docs
    const plan = buildUpdatePlan(savableDocuments, { assets, debts, bills });
    const needsResolution = plan.entries.some(
      e => e.defaultAction === 'update' || e.isOlderStatement || e.billAmountDelta !== 0,
    );

    if (needsResolution) {
      // Show match resolution UI — initialise choices to the recommended defaults
      const initialChoices: Record<string, MatchChoice> = {};
      for (const entry of plan.entries) {
        initialChoices[entry.docId] = entry.defaultAction === 'skip' ? 'skip' : entry.defaultAction;
      }
      setUpdatePlan(plan);
      setMatchChoices(initialChoices);
      return;
    }

    // No matches — apply immediately
    doApplyPlan(plan, {});
  };

  // ── (legacy body) keep existing type-switch logic for direct apply  ─────────

  /** @deprecated Use doApplyPlan + applyUpdatePlan instead.
   *  Kept for reference until full migration. Not called from UI any more. */
  const _legacyDirectSave_UNUSED = () => {
    const accepted = docs.filter(d => d.accepted && d.status !== 'error');

    if (userName.trim()) {
      updateProfile({
        name: userName.trim(),
        hasCompletedOnboarding: true,
        payFrequency: profile?.payFrequency ?? 'Weekly',
        hourlyRate: profile?.hourlyRate ?? 0,
        filingContext: profile?.filingContext ?? 'Single',
      });
    }

    for (const doc of accepted) {
      const f = doc.fields;
      const n = (key: string) => parseFloat(f[key]?.value ?? '') || 0;
      const s = (key: string) => f[key]?.value ?? '';

      switch (doc.docType) {
        case 'Paystub':
          addPaystub({
            employer: s('employer') || 'Unknown',
            date: new Date().toISOString(),
            regularHours: n('regularHours'),
            overtimeHours: n('overtimeHours'),
            doubleTimeHours: n('doubleTimeHours'),
            perDiem: n('perDiem'),
            grossPay: n('grossPay'),
            taxes: (n('federalTax') + n('stateTax') + n('socialSecurity') + n('medicare')) || n('taxes' as any),
            deductions: n('unionDues') + n('insuranceDeductions') + n('otherDeductions'),
            netPay: n('netPay'),
          });
          if (n('hourlyRate') > 0) {
            updateProfile({ hourlyRate: n('hourlyRate') });
          }
          break;

        // ── Banking → Cash ───────────────────────────────────────────────────
        case 'Checking Account':
        case 'Savings Account':
        case 'High-Yield Savings':
        case 'Money Market Account':
        case 'Certificate of Deposit':
        case 'Cash Management Account':
        case 'Bank Statement': {
          const bal = n('currentBalance') || n('closingBalance') || n('availableBalance');
          if (bal > 0) {
            addAsset({
              name: s('accountName') || doc.institutionName || s('institution') || doc.docType,
              type: 'Cash',
              value: bal,
            });
          }
          break;
        }

        // ── Credit / revolving → Debt ────────────────────────────────────────
        case 'Credit Card':
        case 'Credit Card Statement':
        case 'Line of Credit': {
          const bal = n('currentBalance') || n('closingBalance') || n('statementBalance');
          if (bal > 0) {
            addDebt({
              name: s('accountName') || s('issuer') || s('lender') || doc.institutionName || doc.docType,
              balance: bal,
              interestRate: n('apr'),
              minimumPayment: n('minimumPayment'),
            });
          }
          break;
        }

        // ── Installment loans → Debt ─────────────────────────────────────────
        case 'Auto Loan':
        case 'Personal Loan':
        case 'Student Loan': {
          // Auto Loan uses canonical names (loanName, balanceOwed, monthsRemaining);
          // Personal/Student Loan still use currentBalance as fallback.
          const loanBal = n('balanceOwed') || n('currentBalance') || n('principalBalance');
          if (loanBal > 0) {
            addDebt({
              name: s('loanName') || s('servicer') || s('lender') || doc.institutionName || doc.docType,
              balance: loanBal,
              interestRate: n('apr') || n('interestRate'),
              minimumPayment: n('monthlyPayment'),
            });
          }
          break;
        }

        case 'Mortgage':
        case 'HELOC':
          if (n('principalBalance') > 0 || n('currentBalance') > 0) {
            const bal = n('principalBalance') || n('currentBalance');
            addDebt({
              name: `${doc.docType}${doc.institutionName ? ` – ${doc.institutionName}` : s('lender') ? ` – ${s('lender')}` : ''}`,
              balance: bal,
              interestRate: n('interestRate'),
              minimumPayment: n('monthlyPayment'),
            });
          }
          break;

        // ── Brokerage / non-retirement investments → Investment ──────────────
        case 'Brokerage Account':
        case 'Margin Account':
        case 'Robo-Adviser Account':
        case 'Employee Stock Plan':
        case 'Investment Statement':
          if (n('totalValue') > 0) {
            addAsset({
              name: doc.institutionName || s('institution') || s('accountType') || doc.docType,
              type: 'Investment',
              value: n('totalValue'),
            });
          }
          break;

        // ── Workplace retirement → Investment ────────────────────────────────
        case '401(k)':
        case 'Roth 401(k)':
        case '403(b)':
        case '457(b)':
        case 'Thrift Savings Plan':
        case 'Pension': {
          const bal = n('currentBalance') || n('vestedBalance');
          if (bal > 0) {
            const planLabel = s('planName') || doc.docType;
            const providerLabel = doc.institutionName || s('institution') || s('employer');
            addAsset({
              name: `${planLabel}${providerLabel ? ` – ${providerLabel}` : ''}`,
              type: 'Investment',
              value: bal,
            });
          }
          break;
        }

        // ── IRA / HSA → Investment ───────────────────────────────────────────
        case 'Traditional IRA':
        case 'Roth IRA':
        case 'SEP IRA':
        case 'SIMPLE IRA':
        case 'Rollover IRA':
        case 'HSA Investment Account':
        case 'Retirement Account':
        case 'Retirement Statement':
          if (n('currentBalance') > 0) {
            addAsset({
              name: `${doc.docType} – ${doc.institutionName || s('institution') || 'Unknown'}`,
              type: 'Investment',
              value: n('currentBalance'),
            });
          }
          break;

        case 'Monthly Bill':
        case 'Utility Bill':
          if (n('amountDue') > 0) {
            const dueDateRaw = parseInt(s('dueDate'), 10);
            addBill({
              name: s('provider') || s('category') || doc.docType,
              amount: n('amountDue'),
              dueDate: Number.isNaN(dueDateRaw) ? 15 : Math.min(Math.max(dueDateRaw, 1), 31),
              isAutoPay: s('autopay').toLowerCase().includes('yes') || s('autopay').toLowerCase().includes('true'),
            });
          }
          break;
      }
    }

    setStep('done');
  };

  // ─── STEP 0: Upload ──────────────────────────────────────────────────────────

  if (step === 'upload') {
    return (
      <div className="min-h-[100dvh] bg-background flex flex-col">
        <div className="sticky top-0 z-40 bg-secondary text-secondary-foreground px-4 py-4 flex items-center gap-3">
          <button onClick={() => setLocation('/')} className="p-2 rounded-full hover:bg-white/10 transition-colors">
            <X className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-bold text-lg leading-none">Financial Scanner</h1>
            <p className="text-secondary-foreground/70 text-xs mt-0.5">Step 1 of 3 — Upload your documents</p>
          </div>
        </div>

        <div className="flex-1 p-4 max-w-2xl mx-auto w-full space-y-4">
          <div className="bg-accent border border-primary/20 rounded-2xl p-4 flex gap-3">
            <ShieldCheck className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold text-foreground">AI-powered, on-server analysis</div>
              <div className="text-muted-foreground mt-0.5">
                Documents are analyzed by AI to extract financial data. Files are processed and immediately discarded — nothing is stored on our servers. Every value requires your confirmation before saving.
              </div>
            </div>
          </div>

          <div
            className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
              isDragging ? 'border-primary bg-accent' : 'border-border hover:border-primary/50 hover:bg-accent/50'
            }`}
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { e.preventDefault(); setIsDragging(false); addFiles(Array.from(e.dataTransfer.files)); }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.heic,.heif,.pdf"
              multiple
              className="hidden"
              onChange={e => addFiles(Array.from(e.target.files ?? []))}
            />
            <div className="w-16 h-16 rounded-full bg-accent mx-auto mb-4 flex items-center justify-center">
              <Upload className="w-7 h-7 text-primary" />
            </div>
            <div className="font-semibold text-foreground text-lg mb-1">Upload financial documents</div>
            <div className="text-muted-foreground text-sm mb-4">
              JPG · PNG · HEIC · PDF — one document per file works best
            </div>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground h-12 px-8 text-base">
              Choose Files
            </Button>
            <div className="text-xs text-muted-foreground mt-3">or drag and drop here</div>
          </div>

          {globalError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-red-700 dark:text-red-300">{globalError}</div>
                <button
                  className="text-xs text-red-500 dark:text-red-400 underline mt-1"
                  onClick={() => setGlobalError('')}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {files.length === 0 && (
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: '💵', label: 'Paystub', desc: 'Rate, hours, net pay, taxes' },
                { icon: '🏦', label: 'Bank Account', desc: 'Checking, savings balances' },
                { icon: '💳', label: 'Credit Card', desc: 'Balance, limit, APR, min payment' },
                { icon: '🚗', label: 'Auto / Loan', desc: 'Balance, APR, monthly payment' },
                { icon: '📈', label: 'Investments', desc: '401k, IRA, brokerage' },
                { icon: '💡', label: 'Bills', desc: 'Utilities, subscriptions' },
              ].map(t => (
                <div key={t.label} className="bg-card border border-border rounded-xl p-3 text-center">
                  <div className="text-2xl mb-1">{t.icon}</div>
                  <div className="font-semibold text-foreground text-sm">{t.label}</div>
                  <div className="text-muted-foreground text-xs mt-0.5">{t.desc}</div>
                </div>
              ))}
            </div>
          )}

          {files.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-foreground">{files.length} of {MAX_BATCH_FILES} file{files.length !== 1 ? 's' : ''} selected</div>
                <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Plus className="w-4 h-4 mr-1" /> Add more
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {files.map((file, i) => (
                  <div key={i} className="relative group rounded-xl overflow-hidden border border-border aspect-square bg-muted">
                    {previews[i] ? (
                      <img src={previews[i]} alt={file.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <FileImage className="w-8 h-8 text-muted-foreground" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity bg-white rounded-full p-1.5 shadow"
                        onClick={e => { e.stopPropagation(); removeFile(i); }}
                      >
                        <X className="w-4 h-4 text-red-600" />
                      </button>
                    </div>
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] px-2 py-1">
                      <div className="truncate">{file.name}</div>
                      <div className="text-white/70">{(file.size / 1024 / 1024).toFixed(1)} MB</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-background border-t border-border p-4 space-y-2">
          <Button
            className="w-full h-14 text-lg font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl"
            disabled={files.length === 0}
            onClick={startProcessing}
          >
            <ScanLine className="w-5 h-5 mr-2" /> Analyze with AI
          </Button>
          <button
            className="w-full text-sm text-muted-foreground py-2 hover:text-foreground transition-colors"
            onClick={() => setLocation('/onboarding')}
          >
            Skip — enter details manually
          </button>
        </div>
      </div>
    );
  }

  // ─── STEP 1: Processing ───────────────────────────────────────────────────────

  if (step === 'processing') {
    const pct = totalCount > 0 ? Math.round((finishedCount / totalCount) * 100) : 0;

    return (
      <div className="min-h-[100dvh] bg-secondary text-secondary-foreground flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mb-6">
          <ScanLine className="w-9 h-9 text-primary animate-pulse" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Analyzing your documents</h2>
        <p className="text-secondary-foreground/70 mb-6 max-w-xs">
          AI is classifying and extracting financial data from each file.
        </p>

        <div className="w-full max-w-sm space-y-4">
          <div className="text-sm font-semibold">
            Processing {finishedCount} of {totalCount} document{totalCount !== 1 ? 's' : ''}
          </div>
          <div className="h-3 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>

          <div className="flex justify-between text-xs text-secondary-foreground/70 px-1">
            <span>✓ Done: {completedCount}</span>
            {failedCount > 0 && <span className="text-red-400">✗ Failed: {failedCount}</span>}
            {retryingCount > 0 && <span className="text-amber-400">↺ Retrying: {retryingCount}</span>}
            <span>⏳ Remaining: {activeCount}</span>
          </div>

          <div className="space-y-2 mt-2">
            {docs.map((doc) => (
              <div key={doc.id} className="bg-white/10 rounded-xl p-3 text-left flex items-center gap-3">
                <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center">
                  {doc.status === 'done'       && <CheckCircle2 className="w-5 h-5 text-primary" />}
                  {doc.status === 'processing' && <Loader2 className="w-5 h-5 text-primary animate-spin" />}
                  {doc.status === 'retrying'   && <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />}
                  {doc.status === 'error'      && <AlertTriangle className="w-5 h-5 text-red-400" />}
                  {doc.status === 'pending'    && <div className="w-4 h-4 rounded-full border-2 border-white/20" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{doc.file.name}</div>
                  {doc.status === 'done' && (
                    <div className="text-xs text-secondary-foreground/60">
                      {DOC_TYPE_EMOJI[doc.docType] ?? '📄'} {doc.docType}
                    </div>
                  )}
                  {doc.status === 'error' && (
                    <div className="text-xs text-red-300">{doc.error}</div>
                  )}
                  {doc.status === 'processing' && (
                    <div className="text-xs text-secondary-foreground/60">Analyzing…</div>
                  )}
                  {doc.status === 'retrying' && (
                    <div className="text-xs text-amber-300">
                      Waiting to retry ({doc.retryAttempt}/{MAX_RATE_LIMIT_RETRIES}
                      {doc.retryWaitMs ? `, ${Math.round(doc.retryWaitMs / 1000)}s` : ''})
                    </div>
                  )}
                  {doc.status === 'pending' && (
                    <div className="text-xs text-secondary-foreground/40">Queued</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── STEP 2: Review ───────────────────────────────────────────────────────────

  if (step === 'review') {
    return (
      <div className="min-h-[100dvh] bg-background flex flex-col">
        <div className="sticky top-0 z-40 bg-secondary text-secondary-foreground px-4 py-4 flex items-center gap-3">
          <button onClick={() => setStep('upload')} className="p-2 rounded-full hover:bg-white/10 transition-colors">
            <RotateCcw className="w-4 h-4" />
          </button>
          <div>
            <h1 className="font-bold text-lg leading-none">Review Extracted Data</h1>
            <p className="text-secondary-foreground/70 text-xs mt-0.5">Step 2 of 3 — Confirm before saving</p>
          </div>
        </div>

        <div className="flex-1 p-4 max-w-2xl mx-auto w-full space-y-4 pb-36">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold text-amber-900 dark:text-amber-200">Verify every value — AI makes mistakes</div>
              <div className="text-amber-700 dark:text-amber-300 mt-0.5">
                Nothing is saved until you tap Confirm. Edit any field, change the document type, or reject documents you don't want to import.
              </div>
            </div>
          </div>

          {/* Name */}
          <div className="bg-card border border-border rounded-2xl p-4 space-y-2">
            <Label className="text-sm font-semibold">Your Name</Label>
            <Input
              value={userName}
              onChange={e => setUserName(e.target.value)}
              placeholder="Enter your name"
              className="h-11"
            />
          </div>

          {/* ── Match resolution (shown after first "Confirm" click reveals matches) ── */}
          {updatePlan && updatePlan.entries.some(e => e.defaultAction === 'update' || e.isOlderStatement || e.billAmountDelta !== 0) && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <span className="font-semibold text-blue-900 dark:text-blue-200 text-sm">Existing accounts found</span>
              </div>
              <p className="text-xs text-blue-700 dark:text-blue-300">
                We found possible matches in your profile. Choose whether to update the existing record or create a new one.
              </p>
              {updatePlan.entries.filter(e => e.matchedId || e.isOlderStatement || e.billAmountDelta !== 0).map((entry: UpdatePlanEntry) => (
                <div key={entry.docId} className="bg-white dark:bg-background rounded-xl border border-blue-200 dark:border-blue-800 p-3 space-y-2">
                  <div className="text-sm font-medium text-foreground">{entry.docLabel}</div>

                  {entry.isOlderStatement && (
                    <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      This statement may be older than your current data — updating could overwrite newer values.
                    </div>
                  )}

                  {entry.billAmountDelta !== 0 && (
                    <div className={`text-xs rounded-lg p-2 flex items-center gap-1.5 ${
                      entry.billAmountDelta > 0
                        ? 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
                        : 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
                    }`}>
                      <span className="font-bold">{entry.billAmountDelta > 0 ? '↑' : '↓'}</span>
                      Bill amount changed by ${Math.abs(entry.billAmountDelta).toFixed(2)}/mo
                      {entry.billAmountDelta > 0 ? ' (increase)' : ' (decrease)'}
                    </div>
                  )}

                  {entry.matchedId && (
                    <div className="text-xs text-muted-foreground">
                      Match: <span className="font-medium text-foreground">"{entry.matchedName}"</span>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => setMatchChoices(prev => ({ ...prev, [entry.docId]: 'update' }))}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                        (matchChoices[entry.docId] ?? 'update') === 'update'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      Update "{entry.matchedName ?? 'existing'}"
                    </button>
                    <button
                      onClick={() => setMatchChoices(prev => ({ ...prev, [entry.docId]: 'create' }))}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                        matchChoices[entry.docId] === 'create'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      <Plus className="w-3 h-3 inline mr-1" />Create new
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Document cards */}
          {docs.map((doc) => {
            const fieldDefs = DOC_FIELDS[doc.docType] ?? [];
            return (
              <div
                key={doc.id}
                className={`bg-card border rounded-2xl overflow-hidden shadow-sm transition-all ${
                  doc.accepted && doc.status !== 'error' ? 'border-border' : 'border-dashed border-slate-300 dark:border-slate-700 opacity-60'
                }`}
              >
                {/* Doc header */}
                <div className="p-4 border-b border-border flex items-start gap-3">
                  {doc.preview && (
                    <img src={doc.preview} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-semibold text-foreground">
                        {DOC_TYPE_EMOJI[doc.docType] ?? '📄'} {doc.docType}
                      </span>
                      {doc.result && <ConfidenceBadge score={doc.result.classificationConfidence} />}
                      {doc.status === 'error' && (
                        <span className="text-xs text-red-500">Error: {doc.error}</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">{doc.file.name}</div>

                    {/* Institution row */}
                    {doc.status === 'done' && (
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                        <Input
                          value={doc.institutionName}
                          onChange={e => updateInstitution(doc.id, e.target.value)}
                          placeholder="Institution (edit if incorrect)"
                          className="h-7 text-xs flex-1 min-w-[140px] max-w-[220px] bg-background"
                        />
                        {doc.institutionCategory && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                            {doc.institutionCategory}
                          </span>
                        )}
                        {doc.institutionUnknown && doc.institutionName && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex items-center gap-1">
                            <AlertTriangle className="w-2.5 h-2.5" /> Needs confirmation
                          </span>
                        )}
                        {doc.institutionUnknown && doc.institutionName && (
                          <button
                            className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                            onClick={() => saveCustomInstitution(doc.result?.institution?.rawName ?? doc.institutionName, doc.institutionName)}
                          >
                            Save institution
                          </button>
                        )}
                      </div>
                    )}

                    {/* Type selector — only for successfully scanned docs */}
                    {doc.status !== 'error' && (
                      <div className="mt-2 flex items-center gap-2">
                        <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                        <select
                          value={doc.docType}
                          onChange={e => updateDocType(doc.id, e.target.value)}
                          className="text-xs bg-background border border-border rounded-lg px-2 py-1 text-foreground"
                        >
                          {DOC_TYPES.map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Accept/Reject toggle for successful docs */}
                  {doc.status !== 'error' && (
                    <button
                      onClick={() => toggleAccepted(doc.id)}
                      className={`flex-shrink-0 flex items-center gap-1 text-xs px-3 py-1.5 rounded-xl font-medium transition-colors ${
                        doc.accepted
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {doc.accepted
                        ? <><ThumbsUp className="w-3.5 h-3.5" /> Accept</>
                        : <><ThumbsDown className="w-3.5 h-3.5" /> Rejected</>
                      }
                    </button>
                  )}

                  {/* Retry / Remove for failed docs */}
                  {doc.status === 'error' && (
                    <div className="flex-shrink-0 flex flex-col gap-1">
                      <button
                        onClick={() => retryDoc(doc.id)}
                        className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-xl font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Retry
                      </button>
                      <button
                        onClick={() => removeDoc(doc.id)}
                        className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-xl font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    </div>
                  )}
                </div>

                {/* Fields */}
                {doc.accepted && doc.status !== 'error' && fieldDefs.length > 0 && (
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {fieldDefs.map(fd => {
                      const f = doc.fields[fd.key];
                      const hasValue = f?.value != null && f.value !== '';
                      return (
                        <div key={fd.key} className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            {hasValue && <ConfidenceDot score={f!.confidence} />}
                            {!hasValue && <span className="w-2 h-2 rounded-full border border-dashed border-slate-400 inline-block" />}
                            <Label className="text-xs text-muted-foreground">{fd.label}</Label>
                          </div>
                          <div className="relative">
                            {fd.prefix && <span className="absolute left-3 top-3 text-muted-foreground text-sm pointer-events-none">{fd.prefix}</span>}
                            <Input
                              type={fd.type === 'number' ? 'number' : fd.type === 'date' ? 'date' : 'text'}
                              value={f?.value ?? ''}
                              onChange={e => updateField(doc.id, fd.key, e.target.value)}
                              className={`h-11 text-sm bg-background ${fd.prefix ? 'pl-7' : ''} ${!hasValue ? 'border-dashed' : ''}`}
                              placeholder={!hasValue ? 'Not found — enter if known' : undefined}
                              step={fd.type === 'number' ? '0.01' : undefined}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="fixed bottom-0 inset-x-0 bg-background border-t border-border p-4 space-y-2">
          {updatePlan ? (
            <Button
              className="w-full h-14 text-lg font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl"
              onClick={() => {
                // Rebuild the plan fresh from current doc state so any edits
                // made after the match-resolution UI appeared are captured.
                const freshPlan = buildUpdatePlan(savableDocuments, { assets, debts, bills });
                doApplyPlan(freshPlan, matchChoices);
              }}
            >
              <CheckCircle2 className="w-5 h-5 mr-2" />
              Apply Choices &amp; Save
            </Button>
          ) : (
            <Button
              className="w-full h-14 text-lg font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl"
              disabled={
                savableDocuments.length === 0 ||
                docs.some(d => d.status === 'processing' || d.status === 'retrying' || d.status === 'pending')
              }
              onClick={confirmAndSave}
            >
              <CheckCircle2 className="w-5 h-5 mr-2" />
              {docs.some(d => d.status === 'processing' || d.status === 'retrying' || d.status === 'pending')
                ? 'Scanning in progress…'
                : `Confirm & Save ${savableDocuments.length} Document${savableDocuments.length !== 1 ? 's' : ''}`
              }
            </Button>
          )}
          <div className="text-center text-xs text-muted-foreground">
            {updatePlan ? 'Review your choices above, then tap Apply' : 'Nothing is saved until you tap Confirm'}
          </div>
        </div>
      </div>
    );
  }

  // ─── STEP 3: Done ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-[100dvh] bg-secondary text-secondary-foreground flex flex-col items-center justify-center p-6 text-center">
      <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mb-6">
        <CheckCircle2 className="w-10 h-10 text-primary" />
      </div>
      <h2 className="text-3xl font-bold mb-2">Saved!</h2>
      <p className="text-secondary-foreground/70 mb-6 max-w-xs">
        Your financial data is now in the app. Review your dashboard or ask the AI assistant any question.
      </p>

      {/* Undo last import */}
      {lastImportDocId && (
        <div className="mb-6 w-full max-w-xs">
          <button
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-white/20 text-secondary-foreground/80 hover:bg-white/10 transition-colors text-sm"
            onClick={() => {
              undoImport(lastImportDocId);
              setLastImportDocId(null);
              setStep('review');
            }}
          >
            <RotateCcw className="w-4 h-4" />
            Undo this import
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Button
          className="h-14 text-lg bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl"
          onClick={() => setLocation('/dashboard')}
        >
          View Dashboard <ArrowRight className="w-5 h-5 ml-2" />
        </Button>
        <Button
          variant="outline"
          className="h-12 rounded-2xl border-white/20 text-secondary-foreground hover:bg-white/10"
          onClick={() => setLocation('/ask-ai')}
        >
          Ask Blue Collar AI
        </Button>
      </div>
    </div>
  );
}
