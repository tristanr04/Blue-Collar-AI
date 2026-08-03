import React, { useState, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import {
  Upload, ScanLine, CheckCircle2, AlertTriangle, X, Plus, Trash2,
  FileImage, ArrowRight, ShieldCheck, RotateCcw, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useStore } from '@/lib/store';
import {
  runOcrOnFiles, extractFromText,
  ScanResult, ExtractedField,
  ExtractedPaystub, ExtractedBankAccount, ExtractedCreditCard,
  ExtractedLoan, ExtractedInvestment,
} from '@/lib/ocr';

// ─── Confidence dot ───────────────────────────────────────────────────────────

function ConfidenceDot({ confidence, found }: { confidence: string; found: boolean }) {
  if (!found) return (
    <span title="Not found — please fill in" className="inline-block w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-600 flex-shrink-0" />
  );
  const cls = confidence === 'high'
    ? 'bg-emerald-500'
    : confidence === 'medium'
    ? 'bg-amber-400'
    : 'bg-slate-400';
  const label = confidence === 'high' ? 'High confidence' : confidence === 'medium' ? 'Medium confidence' : 'Low confidence — verify';
  return <span title={label} className={`inline-block w-2.5 h-2.5 rounded-full ${cls} flex-shrink-0`} />;
}

// ─── Editable field row ───────────────────────────────────────────────────────

function FieldRow({
  label, ef, onChange, type = 'text', prefix,
}: {
  label: string;
  ef: ExtractedField<any>;
  onChange: (v: string) => void;
  type?: 'text' | 'number' | 'date';
  prefix?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <ConfidenceDot confidence={ef.confidence} found={ef.found} />
      <div className="flex-1 space-y-1">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <div className="relative">
          {prefix && <span className="absolute left-3 top-3 text-muted-foreground text-sm pointer-events-none">{prefix}</span>}
          <Input
            type={type}
            value={ef.value}
            onChange={e => onChange(e.target.value)}
            className={`h-11 bg-background ${prefix ? 'pl-7' : ''} ${!ef.found ? 'border-dashed border-slate-300 dark:border-slate-600' : ''}`}
            step={type === 'number' ? '0.01' : undefined}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
      <button
        className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">{title}</span>
          {count !== undefined && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-accent text-accent-foreground font-medium">{count}</span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="p-4 pt-0 border-t border-border space-y-4">{children}</div>}
    </div>
  );
}

// ─── Types for editable review state ─────────────────────────────────────────

type EditablePaystub = { [K in keyof ExtractedPaystub]: ExtractedField<any> };

interface EditableBankAccount { name: ExtractedField<string>; balance: ExtractedField<number> }
interface EditableCreditCard { name: ExtractedField<string>; balance: ExtractedField<number>; limit: ExtractedField<number>; apr: ExtractedField<number>; minimumPayment: ExtractedField<number> }
interface EditableLoan { name: ExtractedField<string>; balance: ExtractedField<number>; apr: ExtractedField<number>; monthlyPayment: ExtractedField<number> }
interface EditableInvestment { name: ExtractedField<string>; value: ExtractedField<number> }

interface ReviewState {
  userName: string;
  hourlyRateFromProfile: number;
  paystub: EditablePaystub | null;
  bankAccounts: EditableBankAccount[];
  creditCards: EditableCreditCard[];
  loans: EditableLoan[];
  investments: EditableInvestment[];
}

function makeField<T>(value: T, confidence = 'high', found = true): ExtractedField<T> {
  return { value, confidence: confidence as any, found };
}

function blankBankAccount(): EditableBankAccount {
  return { name: makeField('', 'low', false), balance: makeField(0, 'low', false) };
}
function blankCreditCard(): EditableCreditCard {
  return { name: makeField('', 'low', false), balance: makeField(0, 'low', false), limit: makeField(0, 'low', false), apr: makeField(0, 'low', false), minimumPayment: makeField(0, 'low', false) };
}
function blankLoan(): EditableLoan {
  return { name: makeField('', 'low', false), balance: makeField(0, 'low', false), apr: makeField(0, 'low', false), monthlyPayment: makeField(0, 'low', false) };
}
function blankInvestment(): EditableInvestment {
  return { name: makeField('', 'low', false), value: makeField(0, 'low', false) };
}

function scanResultToReview(result: ScanResult, existingName: string): ReviewState {
  return {
    userName: existingName || '',
    hourlyRateFromProfile: result.paystub?.hourlyRate.value ?? 0,
    paystub: result.paystub as EditablePaystub | null,
    bankAccounts: result.bankAccounts as EditableBankAccount[],
    creditCards: result.creditCards as EditableCreditCard[],
    loans: result.loans as EditableLoan[],
    investments: result.investments as EditableInvestment[],
  };
}

// ─── Steps ────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'processing' | 'review' | 'done';

// ─── Main component ───────────────────────────────────────────────────────────

export default function Scanner() {
  const [_, setLocation] = useLocation();
  const { profile, updateProfile, addPaystub, addDebt, addBill, addAsset } = useStore();

  const [step, setStep] = useState<Step>('upload');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [fileProgress, setFileProgress] = useState<number[]>([]);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File handling ──────────────────────────────────────────────────────────

  const addFiles = useCallback((newFiles: File[]) => {
    const images = newFiles.filter(f => f.type.startsWith('image/'));
    setFiles(prev => {
      const combined = [...prev, ...images];
      setPreviews(combined.map(f => URL.createObjectURL(f)));
      return combined;
    });
  }, []);

  const removeFile = (i: number) => {
    setFiles(prev => {
      const next = prev.filter((_, idx) => idx !== i);
      setPreviews(next.map(f => URL.createObjectURL(f)));
      return next;
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  // ── OCR processing ─────────────────────────────────────────────────────────

  const startProcessing = async () => {
    if (files.length === 0) return;
    setStep('processing');
    setFileProgress(files.map(() => 0));
    setErrorMsg('');

    try {
      const results = await runOcrOnFiles(files, (fileIndex, progress) => {
        setFileProgress(prev => {
          const next = [...prev];
          next[fileIndex] = progress;
          return next;
        });
      });

      const combinedText = results.map(r => r.text).join('\n\n\f\n\n');
      const scanResult = extractFromText(combinedText);
      setReview(scanResultToReview(scanResult, profile?.name ?? ''));
      setStep('review');
    } catch (err) {
      setErrorMsg('OCR failed. Please try again or enter details manually.');
      setStep('upload');
    }
  };

  // ── Confirm & save ─────────────────────────────────────────────────────────

  const confirmAndSave = () => {
    if (!review) return;

    // Profile
    const hourly = Number(review.paystub?.hourlyRate.value ?? review.hourlyRateFromProfile ?? 0);
    updateProfile({
      name: review.userName || profile?.name || 'You',
      hourlyRate: hourly,
      hasCompletedOnboarding: true,
      payFrequency: profile?.payFrequency ?? 'Weekly',
      filingContext: profile?.filingContext ?? 'Single',
    });

    // Paystub
    if (review.paystub) {
      const p = review.paystub;
      addPaystub({
        employer: String(p.employer.value) || 'Unknown',
        date: new Date().toISOString(),
        regularHours: Number(p.regularHours.value) || 0,
        overtimeHours: Number(p.overtimeHours.value) || 0,
        doubleTimeHours: Number(p.doubleTimeHours.value) || 0,
        perDiem: Number(p.perDiem.value) || 0,
        grossPay: Number(p.grossPay.value) || 0,
        taxes: Number(p.taxes.value) || 0,
        deductions: Number(p.deductions.value) || 0,
        netPay: Number(p.netPay.value) || 0,
      });
    }

    // Bank accounts
    for (const a of review.bankAccounts) {
      addAsset({ name: String(a.name.value) || 'Bank Account', type: 'Cash', value: Number(a.balance.value) || 0 });
    }

    // Credit cards
    for (const c of review.creditCards) {
      addDebt({
        name: String(c.name.value) || 'Credit Card',
        balance: Number(c.balance.value) || 0,
        interestRate: Number(c.apr.value) || 0,
        minimumPayment: Number(c.minimumPayment.value) || 0,
      });
    }

    // Loans
    for (const l of review.loans) {
      addDebt({
        name: String(l.name.value) || 'Loan',
        balance: Number(l.balance.value) || 0,
        interestRate: Number(l.apr.value) || 0,
        minimumPayment: Number(l.monthlyPayment.value) || 0,
      });
    }

    // Investments
    for (const inv of review.investments) {
      addAsset({ name: String(inv.name.value) || 'Investment', type: 'Investment', value: Number(inv.value.value) || 0 });
    }

    setStep('done');
  };

  // ── Update helpers ─────────────────────────────────────────────────────────

  const updatePaystubField = (field: keyof ExtractedPaystub, value: string) => {
    setReview(r => r && r.paystub ? {
      ...r,
      paystub: { ...r.paystub, [field]: { ...r.paystub[field], value, found: true } },
    } : r);
  };

  const updateBankField = (i: number, field: keyof EditableBankAccount, value: string) => {
    setReview(r => r ? {
      ...r,
      bankAccounts: r.bankAccounts.map((a, idx) =>
        idx === i ? { ...a, [field]: { ...a[field], value, found: true } } : a
      ),
    } : r);
  };

  const updateCardField = (i: number, field: keyof EditableCreditCard, value: string) => {
    setReview(r => r ? {
      ...r,
      creditCards: r.creditCards.map((c, idx) =>
        idx === i ? { ...c, [field]: { ...c[field], value, found: true } } : c
      ),
    } : r);
  };

  const updateLoanField = (i: number, field: keyof EditableLoan, value: string) => {
    setReview(r => r ? {
      ...r,
      loans: r.loans.map((l, idx) =>
        idx === i ? { ...l, [field]: { ...l[field], value, found: true } } : l
      ),
    } : r);
  };

  const updateInvestmentField = (i: number, field: keyof EditableInvestment, value: string) => {
    setReview(r => r ? {
      ...r,
      investments: r.investments.map((inv, idx) =>
        idx === i ? { ...inv, [field]: { ...inv[field], value, found: true } } : inv
      ),
    } : r);
  };

  // ─── STEP 0: Upload ──────────────────────────────────────────────────────────

  if (step === 'upload') {
    return (
      <div className="min-h-[100dvh] bg-background flex flex-col">
        {/* Header */}
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

          {/* Privacy notice */}
          <div className="bg-accent border border-primary/20 rounded-2xl p-4 flex gap-3">
            <ShieldCheck className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold text-foreground">Processed entirely on your device</div>
              <div className="text-muted-foreground mt-0.5">
                Images are analyzed locally using on-device OCR. Nothing is sent to any server. Extractions are best-effort estimates — you confirm every value before anything is saved.
              </div>
            </div>
          </div>

          {/* Drop zone */}
          <div
            className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
              isDragging ? 'border-primary bg-accent' : 'border-border hover:border-primary/50 hover:bg-accent/50'
            }`}
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => addFiles(Array.from(e.target.files ?? []))}
            />
            <div className="w-16 h-16 rounded-full bg-accent mx-auto mb-4 flex items-center justify-center">
              <Upload className="w-7 h-7 text-primary" />
            </div>
            <div className="font-semibold text-foreground text-lg mb-1">Upload screenshots</div>
            <div className="text-muted-foreground text-sm mb-4">
              Paystubs, bank statements, credit cards, loan statements, investment accounts
            </div>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground h-12 px-8 text-base">
              Choose Photos
            </Button>
            <div className="text-xs text-muted-foreground mt-3">or drag and drop images here</div>
          </div>

          {/* Tip cards */}
          {files.length === 0 && (
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: '💵', label: 'Paystub', desc: 'Rate, hours, net pay' },
                { icon: '🏦', label: 'Bank Account', desc: 'Checking, savings balance' },
                { icon: '💳', label: 'Credit Card', desc: 'Balance, limit, APR' },
                { icon: '📈', label: 'Investment', desc: '401k, IRA, brokerage' },
              ].map(t => (
                <div key={t.label} className="bg-card border border-border rounded-xl p-3 text-center">
                  <div className="text-2xl mb-1">{t.icon}</div>
                  <div className="font-semibold text-foreground text-sm">{t.label}</div>
                  <div className="text-muted-foreground text-xs mt-0.5">{t.desc}</div>
                </div>
              ))}
            </div>
          )}

          {/* File previews */}
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
                    <img src={previews[i]} alt={file.name} className="w-full h-full object-cover" />
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

          {errorMsg && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 flex gap-3 text-destructive">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Sticky bottom CTA */}
        <div className="sticky bottom-0 bg-background border-t border-border p-4 space-y-2">
          <Button
            className="w-full h-14 text-lg font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl"
            disabled={files.length === 0}
            onClick={startProcessing}
          >
            <ScanLine className="w-5 h-5 mr-2" /> Analyze My Finances
          </Button>
          <button
            className="w-full text-sm text-muted-foreground py-2 hover:text-foreground transition-colors"
            onClick={() => setLocation('/onboarding')}
          >
            Skip scan — enter manually
          </button>
        </div>
      </div>
    );
  }

  // ─── STEP 1: Processing ───────────────────────────────────────────────────────

  if (step === 'processing') {
    const totalProgress = fileProgress.length > 0
      ? Math.round(fileProgress.reduce((s, p) => s + p, 0) / fileProgress.length)
      : 0;

    return (
      <div className="min-h-[100dvh] bg-secondary text-secondary-foreground flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mb-6 relative">
          <ScanLine className="w-9 h-9 text-primary animate-pulse" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Reading your documents</h2>
        <p className="text-secondary-foreground/70 mb-8 max-w-xs">
          Running on-device OCR — this stays on your device and may take a moment per image.
        </p>

        <div className="w-full max-w-sm space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Overall progress</span>
              <span className="font-semibold">{totalProgress}%</span>
            </div>
            <Progress value={totalProgress} className="h-3 rounded-full" />
          </div>

          <div className="space-y-2 mt-4">
            {files.map((file, i) => (
              <div key={i} className="bg-white/10 rounded-xl p-3 text-left">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium truncate flex-1 mr-2">{file.name}</span>
                  <span className="text-xs text-secondary-foreground/60 flex-shrink-0">
                    {fileProgress[i] === 100 ? (
                      <CheckCircle2 className="w-4 h-4 text-primary inline" />
                    ) : `${fileProgress[i] ?? 0}%`}
                  </span>
                </div>
                <Progress value={fileProgress[i] ?? 0} className="h-1.5 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── STEP 2: Review ───────────────────────────────────────────────────────────

  if (step === 'review' && review) {
    const totalExtracted =
      (review.paystub ? 1 : 0) +
      review.bankAccounts.length +
      review.creditCards.length +
      review.loans.length +
      review.investments.length;

    return (
      <div className="min-h-[100dvh] bg-background flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-40 bg-secondary text-secondary-foreground px-4 py-4">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => setStep('upload')} className="p-2 rounded-full hover:bg-white/10 transition-colors">
              <RotateCcw className="w-4 h-4" />
            </button>
            <div>
              <h1 className="font-bold text-lg leading-none">Review Extracted Data</h1>
              <p className="text-secondary-foreground/70 text-xs mt-0.5">Step 2 of 3 — Confirm everything before saving</p>
            </div>
          </div>
        </div>

        <div className="flex-1 p-4 max-w-2xl mx-auto w-full space-y-4 pb-32">

          {/* Warning banner */}
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold text-amber-900 dark:text-amber-200">Best-effort estimate — nothing is saved yet</div>
              <div className="text-amber-700 dark:text-amber-300 mt-0.5">
                OCR is not guaranteed. Please verify every field. Tap a value to edit it.
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> High confidence</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Check carefully</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-400 inline-block" /> Not found</span>
              </div>
            </div>
          </div>

          {/* Results summary */}
          <div className="flex items-center gap-2 px-1">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">
              Found {totalExtracted} section{totalExtracted !== 1 ? 's' : ''} across {files.length} image{files.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Your Name */}
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <h3 className="font-semibold text-foreground">Your Profile</h3>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">First Name</Label>
              <Input
                value={review.userName}
                onChange={e => setReview(r => r ? { ...r, userName: e.target.value } : r)}
                placeholder="Enter your name"
                className="h-11"
              />
            </div>
          </div>

          {/* Paystub */}
          {review.paystub ? (
            <Section title="Pay Information" count={1}>
              <FieldRow label="Employer" ef={review.paystub.employer} onChange={v => updatePaystubField('employer', v)} />
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Hourly Rate" ef={review.paystub.hourlyRate} onChange={v => updatePaystubField('hourlyRate', v)} type="number" prefix="$" />
                <FieldRow label="Regular Hours" ef={review.paystub.regularHours} onChange={v => updatePaystubField('regularHours', v)} type="number" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <FieldRow label="OT Hours (1.5x)" ef={review.paystub.overtimeHours} onChange={v => updatePaystubField('overtimeHours', v)} type="number" />
                <FieldRow label="DT Hours (2x)" ef={review.paystub.doubleTimeHours} onChange={v => updatePaystubField('doubleTimeHours', v)} type="number" />
                <FieldRow label="Per Diem ($)" ef={review.paystub.perDiem} onChange={v => updatePaystubField('perDiem', v)} type="number" prefix="$" />
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
                <FieldRow label="Gross Pay" ef={review.paystub.grossPay} onChange={v => updatePaystubField('grossPay', v)} type="number" prefix="$" />
                <FieldRow label="Taxes" ef={review.paystub.taxes} onChange={v => updatePaystubField('taxes', v)} type="number" prefix="$" />
                <FieldRow label="Deductions" ef={review.paystub.deductions} onChange={v => updatePaystubField('deductions', v)} type="number" prefix="$" />
                <FieldRow label="Net Pay" ef={review.paystub.netPay} onChange={v => updatePaystubField('netPay', v)} type="number" prefix="$" />
              </div>
            </Section>
          ) : (
            <div className="bg-card border border-dashed border-border rounded-2xl p-4 text-center text-muted-foreground text-sm">
              No paystub detected.{' '}
              <button className="text-primary font-medium" onClick={() => setReview(r => r ? {
                ...r,
                paystub: {
                  employer: makeField('', 'low', false), date: makeField('', 'low', false),
                  hourlyRate: makeField(0, 'low', false), regularHours: makeField(40, 'low', false),
                  overtimeHours: makeField(0, 'low', false), doubleTimeHours: makeField(0, 'low', false),
                  perDiem: makeField(0, 'low', false), grossPay: makeField(0, 'low', false),
                  taxes: makeField(0, 'low', false), deductions: makeField(0, 'low', false),
                  netPay: makeField(0, 'low', false),
                }
              } : r)}>Add pay info</button>
            </div>
          )}

          {/* Bank Accounts */}
          <Section title="Bank Accounts" count={review.bankAccounts.length}>
            {review.bankAccounts.map((acct, i) => (
              <div key={i} className="space-y-3 border border-border rounded-xl p-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-foreground">Account {i + 1}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setReview(r => r ? { ...r, bankAccounts: r.bankAccounts.filter((_, idx) => idx !== i) } : r)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label="Account Name" ef={acct.name} onChange={v => updateBankField(i, 'name', v)} />
                  <FieldRow label="Balance" ef={acct.balance} onChange={v => updateBankField(i, 'balance', v)} type="number" prefix="$" />
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-full" onClick={() => setReview(r => r ? { ...r, bankAccounts: [...r.bankAccounts, blankBankAccount()] } : r)}>
              <Plus className="w-4 h-4 mr-1" /> Add bank account
            </Button>
          </Section>

          {/* Credit Cards */}
          <Section title="Credit Cards" count={review.creditCards.length}>
            {review.creditCards.map((card, i) => (
              <div key={i} className="space-y-3 border border-border rounded-xl p-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-foreground">Card {i + 1}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setReview(r => r ? { ...r, creditCards: r.creditCards.filter((_, idx) => idx !== i) } : r)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <FieldRow label="Card Name" ef={card.name} onChange={v => updateCardField(i, 'name', v)} />
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label="Balance Owed" ef={card.balance} onChange={v => updateCardField(i, 'balance', v)} type="number" prefix="$" />
                  <FieldRow label="Credit Limit" ef={card.limit} onChange={v => updateCardField(i, 'limit', v)} type="number" prefix="$" />
                  <FieldRow label="APR (%)" ef={card.apr} onChange={v => updateCardField(i, 'apr', v)} type="number" />
                  <FieldRow label="Min Payment" ef={card.minimumPayment} onChange={v => updateCardField(i, 'minimumPayment', v)} type="number" prefix="$" />
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-full" onClick={() => setReview(r => r ? { ...r, creditCards: [...r.creditCards, blankCreditCard()] } : r)}>
              <Plus className="w-4 h-4 mr-1" /> Add credit card
            </Button>
          </Section>

          {/* Loans */}
          <Section title="Loans & Debts" count={review.loans.length}>
            {review.loans.map((loan, i) => (
              <div key={i} className="space-y-3 border border-border rounded-xl p-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-foreground">Loan {i + 1}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setReview(r => r ? { ...r, loans: r.loans.filter((_, idx) => idx !== i) } : r)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <FieldRow label="Loan Name" ef={loan.name} onChange={v => updateLoanField(i, 'name', v)} />
                <div className="grid grid-cols-3 gap-3">
                  <FieldRow label="Balance" ef={loan.balance} onChange={v => updateLoanField(i, 'balance', v)} type="number" prefix="$" />
                  <FieldRow label="APR (%)" ef={loan.apr} onChange={v => updateLoanField(i, 'apr', v)} type="number" />
                  <FieldRow label="Monthly Pmt" ef={loan.monthlyPayment} onChange={v => updateLoanField(i, 'monthlyPayment', v)} type="number" prefix="$" />
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-full" onClick={() => setReview(r => r ? { ...r, loans: [...r.loans, blankLoan()] } : r)}>
              <Plus className="w-4 h-4 mr-1" /> Add loan
            </Button>
          </Section>

          {/* Investments */}
          <Section title="Investments" count={review.investments.length}>
            {review.investments.map((inv, i) => (
              <div key={i} className="space-y-3 border border-border rounded-xl p-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-foreground">Account {i + 1}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setReview(r => r ? { ...r, investments: r.investments.filter((_, idx) => idx !== i) } : r)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label="Account Name" ef={inv.name} onChange={v => updateInvestmentField(i, 'name', v)} />
                  <FieldRow label="Current Value" ef={inv.value} onChange={v => updateInvestmentField(i, 'value', v)} type="number" prefix="$" />
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-full" onClick={() => setReview(r => r ? { ...r, investments: [...r.investments, blankInvestment()] } : r)}>
              <Plus className="w-4 h-4 mr-1" /> Add investment
            </Button>
          </Section>
        </div>

        {/* Sticky confirm */}
        <div className="fixed bottom-0 inset-x-0 bg-background border-t border-border p-4 space-y-2">
          <Button
            className="w-full h-14 text-lg font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl"
            onClick={confirmAndSave}
          >
            <CheckCircle2 className="w-5 h-5 mr-2" /> Confirm &amp; Save Everything
          </Button>
          <div className="text-center text-xs text-muted-foreground">
            Nothing is saved until you tap Confirm
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
      <h2 className="text-3xl font-bold mb-2">All saved!</h2>
      <p className="text-secondary-foreground/70 mb-10 max-w-xs">
        Your financial picture is set up. Everything stays on this device.
      </p>
      <Button
        className="h-14 px-10 text-lg bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl"
        onClick={() => setLocation('/dashboard')}
      >
        Go to Dashboard <ArrowRight className="w-5 h-5 ml-2" />
      </Button>
    </div>
  );
}
