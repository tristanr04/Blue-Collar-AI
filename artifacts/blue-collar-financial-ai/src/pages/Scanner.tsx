import React, { useState, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import {
  Upload, ScanLine, CheckCircle2, AlertTriangle, X, Plus, Trash2,
  ArrowRight, ShieldCheck, RotateCcw, ChevronDown, ChevronDown as ChevronUp,
  Loader2, FileImage, ThumbsUp, ThumbsDown, Edit2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/lib/store';
import { scanFile, ScanResult, ScanFieldValue } from '@/lib/api';

// ─── Document types ───────────────────────────────────────────────────────────

const DOC_TYPES = [
  'Paystub', 'Checking Account', 'Savings Account', 'Bank Statement',
  'Credit Card', 'Credit Card Statement', 'Auto Loan', 'Personal Loan',
  'Mortgage', 'Brokerage Account', 'Investment Statement',
  'Retirement Account', 'Retirement Statement', 'Monthly Bill', 'Utility Bill', 'Unknown',
];

const DOC_TYPE_EMOJI: Record<string, string> = {
  'Paystub': '💵', 'Checking Account': '🏦', 'Savings Account': '🏦',
  'Bank Statement': '🏦', 'Credit Card': '💳', 'Credit Card Statement': '💳',
  'Auto Loan': '🚗', 'Personal Loan': '📋', 'Mortgage': '🏠',
  'Brokerage Account': '📈', 'Investment Statement': '📈',
  'Retirement Account': '🏦', 'Retirement Statement': '🏦',
  'Monthly Bill': '📄', 'Utility Bill': '💡', 'Unknown': '❓',
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
    { key: 'lender', label: 'Lender' },
    { key: 'loanName', label: 'Loan Name' },
    { key: 'lastFour', label: 'Last 4 Digits' },
    { key: 'currentBalance', label: 'Balance Owed', type: 'number', prefix: '$' },
    { key: 'originalAmount', label: 'Original Amount', type: 'number', prefix: '$' },
    { key: 'apr', label: 'APR (%)', type: 'number' },
    { key: 'monthlyPayment', label: 'Monthly Payment', type: 'number', prefix: '$' },
    { key: 'remainingTermMonths', label: 'Months Remaining', type: 'number' },
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

// ─── Types ────────────────────────────────────────────────────────────────────

type ProcessStatus = 'pending' | 'processing' | 'done' | 'error';

interface ProcessedDoc {
  id: string;
  file: File;
  preview: string;
  status: ProcessStatus;
  error?: string;
  errorStage?: string;
  result?: ScanResult;
  // Editable state
  docType: string;
  fields: Record<string, { value: string; confidence: number }>;
  accepted: boolean;
}

// ─── Main component ───────────────────────────────────────────────────────────

type Step = 'upload' | 'processing' | 'review' | 'done';

export default function Scanner() {
  const [_, setLocation] = useLocation();
  const store = useStore();
  const { updateProfile, addPaystub, addDebt, addBill, addAsset, profile } = store;

  const [step, setStep] = useState<Step>('upload');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [docs, setDocs] = useState<ProcessedDoc[]>([]);
  const [userName, setUserName] = useState(profile?.name ?? '');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [globalError, setGlobalError] = useState('');

  // ── File handling ──────────────────────────────────────────────────────────

  const addFiles = useCallback((newFiles: File[]) => {
    // Accept files whose MIME starts with image/, PDF, HEIC/HEIF, or whose
    // extension implies an image format. On iOS Safari, JPEG files from the
    // Photos or Files app often arrive with f.type === "" — the extension
    // check catches those so they aren't silently dropped.
    const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i;
    const valid = newFiles.filter(f =>
      f.type.startsWith('image/') ||
      f.type === 'application/pdf' ||
      IMAGE_EXT.test(f.name) ||
      /\.pdf$/i.test(f.name)
    );

    // Generate previews OUTSIDE the state updater so URL.createObjectURL is
    // never called twice (React 18 Strict Mode runs updaters twice in dev).
    // Wrapped in try/catch because iOS Safari throws
    // "The string did not match the expected pattern" for certain file types.
    const newPreviews = valid.map(f => {
      try {
        if (f.type.startsWith('image/') || IMAGE_EXT.test(f.name)) {
          return URL.createObjectURL(f);
        }
      } catch {
        // Silently fall back — preview is cosmetic, upload still works
      }
      return '';
    });

    setFiles(prev => [...prev, ...valid]);
    setPreviews(prev => [...prev, ...newPreviews]);
  }, []);

  const removeFile = (i: number) => {
    setFiles(prev => prev.filter((_, idx) => idx !== i));
    setPreviews(prev => prev.filter((_, idx) => idx !== i));
  };

  // ── Parse structured API errors ────────────────────────────────────────────

  const parseApiError = (err: unknown): { stage: string; message: string } => {
    if (err instanceof Error) {
      try {
        const parsed = JSON.parse(err.message);
        return { stage: parsed.stage ?? 'unknown', message: parsed.message ?? err.message };
      } catch {
        return { stage: 'unknown', message: err.message };
      }
    }
    return { stage: 'unknown', message: String(err) };
  };

  // ── Null-safe field value extractor ───────────────────────────────────────
  // The AI can return fields in three shapes:
  //   { value: ..., confidence: ... }   ← normal
  //   null                              ← field not found (crashes on .value)
  //   "string" | number | boolean       ← flat value without wrapper
  // This helper normalises all three without ever throwing.

  const getFieldValue = (raw: unknown): { value: string | null; confidence: number } => {
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
  };

  // ── Process a single file and update its doc entry ─────────────────────────

  const processDoc = async (docId: string, file: File) => {
    setDocs(prev => prev.map(d => d.id === docId ? { ...d, status: 'processing', error: undefined } : d));
    try {
      const result = await scanFile(file);

      // Dev-mode logging for bill documents so the raw AI shape is visible
      // in the browser console without exposing image data or account numbers.
      if (import.meta.env.DEV) {
        const dt = (result.docType ?? '').toLowerCase();
        if (dt.includes('bill') || dt.includes('utility')) {
          console.group(`[Scanner] Raw bill extraction — ${file.name}`);
          console.log('docType:', result.docType);
          console.log('classificationConfidence:', result.classificationConfidence);
          console.log('fields (raw):', JSON.stringify(result.fields ?? {}, null, 2));
          console.groupEnd();
        }
      }

      const fieldMap: Record<string, { value: string; confidence: number }> = {};
      for (const [k, v] of Object.entries(result.fields ?? {})) {
        // Use getFieldValue so null fields and flat values never crash
        const { value, confidence } = getFieldValue(v);
        if (value != null) {
          fieldMap[k] = { value, confidence };
        }
      }
      setDocs(prev => prev.map(d => d.id === docId ? {
        ...d,
        status: 'done',
        result,
        docType: result.docType ?? 'Unknown',
        fields: fieldMap,
        error: undefined,
      } : d));
    } catch (err) {
      const { stage, message } = parseApiError(err);
      setDocs(prev => prev.map(d => d.id === docId ? {
        ...d,
        status: 'error',
        error: message,
        errorStage: stage,
        docType: 'Unknown',
        fields: {},
        accepted: false,
      } : d));
    }
  };

  // ── Start processing ───────────────────────────────────────────────────────

  const startProcessing = async () => {
    if (files.length === 0) return;
    setStep('processing');
    setGlobalError('');

    const initial: ProcessedDoc[] = files.map((f, i) => ({
      id: crypto.randomUUID(),
      file: f,
      preview: previews[i] ?? '',
      status: 'pending',
      docType: 'Unknown',
      fields: {},
      accepted: true,
    }));
    setDocs(initial);

    // Process sequentially — update individual statuses as each completes
    for (const doc of initial) {
      await processDoc(doc.id, doc.file);
    }
    setStep('review');
  };

  // ── Retry a failed doc ─────────────────────────────────────────────────────

  const retryDoc = async (docId: string) => {
    const doc = docs.find(d => d.id === docId);
    if (!doc) return;
    await processDoc(docId, doc.file);
  };

  // ── Remove a doc from the list ─────────────────────────────────────────────

  const removeDoc = (docId: string) => {
    setDocs(prev => prev.filter(d => d.id !== docId));
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

  const toggleAccepted = (docId: string) => {
    setDocs(prev => prev.map(d => d.id === docId ? { ...d, accepted: !d.accepted } : d));
  };

  // ── Confirm & save ─────────────────────────────────────────────────────────

  const confirmAndSave = () => {
    const accepted = docs.filter(d => d.accepted && d.status !== 'error');

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

        case 'Checking Account':
        case 'Savings Account':
        case 'Bank Statement':
          if (n('currentBalance') > 0 || n('closingBalance') > 0) {
            addAsset({
              name: s('accountName') || s('institution') || doc.docType,
              type: 'Cash',
              value: n('currentBalance') || n('closingBalance'),
            });
          }
          break;

        case 'Credit Card':
        case 'Credit Card Statement':
          if (n('currentBalance') > 0 || n('closingBalance') > 0) {
            addDebt({
              name: s('accountName') || s('issuer') || 'Credit Card',
              balance: n('currentBalance') || n('closingBalance'),
              interestRate: n('apr'),
              minimumPayment: n('minimumPayment'),
            });
          }
          break;

        case 'Auto Loan':
        case 'Personal Loan':
          if (n('currentBalance') > 0) {
            addDebt({
              name: s('loanName') || s('lender') || doc.docType,
              balance: n('currentBalance'),
              interestRate: n('apr'),
              minimumPayment: n('monthlyPayment'),
            });
          }
          break;

        case 'Mortgage':
          if (n('principalBalance') > 0) {
            addDebt({
              name: `Mortgage${s('lender') ? ` – ${s('lender')}` : ''}`,
              balance: n('principalBalance'),
              interestRate: n('interestRate'),
              minimumPayment: n('monthlyPayment'),
            });
          }
          break;

        case 'Brokerage Account':
        case 'Investment Statement':
          if (n('totalValue') > 0) {
            addAsset({
              name: s('institution') || s('accountType') || 'Brokerage',
              type: 'Investment',
              value: n('totalValue'),
            });
          }
          break;

        case 'Retirement Account':
        case 'Retirement Statement':
          if (n('currentBalance') > 0) {
            addAsset({
              name: `${s('accountType') || 'Retirement'} – ${s('institution') || 'Unknown'}`,
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
                <div className="font-semibold text-foreground">{files.length} file{files.length !== 1 ? 's' : ''} ready</div>
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
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] px-2 py-1 truncate">
                      {file.name}
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
    const done = docs.filter(d => d.status === 'done' || d.status === 'error').length;
    const total = docs.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    return (
      <div className="min-h-[100dvh] bg-secondary text-secondary-foreground flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mb-6">
          <ScanLine className="w-9 h-9 text-primary animate-pulse" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Analyzing your documents</h2>
        <p className="text-secondary-foreground/70 mb-8 max-w-xs">
          AI is classifying and extracting financial data from each file.
        </p>

        <div className="w-full max-w-sm space-y-4">
          <div className="text-sm font-medium">{done} of {total} complete</div>
          <div className="h-3 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>

          <div className="space-y-2 mt-2">
            {docs.map((doc) => (
              <div key={doc.id} className="bg-white/10 rounded-xl p-3 text-left flex items-center gap-3">
                <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center">
                  {doc.status === 'done' && <CheckCircle2 className="w-5 h-5 text-primary" />}
                  {doc.status === 'processing' && <Loader2 className="w-5 h-5 text-primary animate-spin" />}
                  {doc.status === 'error' && <AlertTriangle className="w-5 h-5 text-red-400" />}
                  {doc.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-white/20" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{doc.file.name}</div>
                  {doc.status === 'done' && doc.result && (
                    <div className="text-xs text-secondary-foreground/60">
                      {DOC_TYPE_EMOJI[doc.result.docType] ?? '📄'} {doc.result.docType} · {doc.result.classificationConfidence}% confidence
                    </div>
                  )}
                  {doc.status === 'error' && (
                    <div className="text-xs text-red-300">{doc.error}</div>
                  )}
                  {doc.status === 'processing' && (
                    <div className="text-xs text-secondary-foreground/60">Analyzing…</div>
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
    const accepted = docs.filter(d => d.accepted && d.status !== 'error');

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
          <Button
            className="w-full h-14 text-lg font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl"
            disabled={accepted.length === 0}
            onClick={confirmAndSave}
          >
            <CheckCircle2 className="w-5 h-5 mr-2" />
            Confirm &amp; Save {accepted.length} Document{accepted.length !== 1 ? 's' : ''}
          </Button>
          <div className="text-center text-xs text-muted-foreground">Nothing is saved until you tap Confirm</div>
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
      <p className="text-secondary-foreground/70 mb-10 max-w-xs">
        Your financial data is now in the app. Review your dashboard or ask the AI assistant any question.
      </p>
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
