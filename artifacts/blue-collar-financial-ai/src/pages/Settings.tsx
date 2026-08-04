import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  Shield, Trash2, RefreshCw, User, Lock, AlertTriangle,
  ChevronRight, Download, Upload, CheckCircle2, History,
  RotateCcw, ChevronDown, ChevronUp, Calculator,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useStore, PayFrequency, FilingContext, FinancialChangeRecord } from '@/lib/store';
import { US_STATE_CODES, TAX_FILING_STATUSES } from '@/lib/profile-context-api';

export default function Settings() {
  const [_, setLocation] = useLocation();
  const {
    profile, updateProfile, resetToDemo, clearAll, changeHistory, undoImport, restoreFieldValue,
    profileContext, saveProfileContext, profileContextSaving, profileContextError,
  } = useStore();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [saved, setSaved] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [importError, setImportError] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedImport, setExpandedImport] = useState<string | null>(null);

  // ── Profile context form ─────────────────────────────────────────────────────
  // Use loose string types so Select.onValueChange (which returns string) can write freely.
  const [ctxForm, setCtxForm] = useState<{
    birthDate: string;
    stateCode: string;
    taxFilingStatus: string;
    qualifyingChildren: number;
    otherDependents: number;
    spouseHasIncome: boolean;
    additionalAnnualIncome: number;
    annualPreTaxDeductions: number;
  }>({
    birthDate: profileContext?.birthDate ?? '',
    stateCode: profileContext?.stateCode ?? '',
    taxFilingStatus: profileContext?.taxFilingStatus ?? 'Single',
    qualifyingChildren: profileContext?.qualifyingChildren ?? 0,
    otherDependents: profileContext?.otherDependents ?? 0,
    spouseHasIncome: profileContext?.spouseHasIncome ?? false,
    additionalAnnualIncome: profileContext?.additionalAnnualIncome ?? 0,
    annualPreTaxDeductions: profileContext?.annualPreTaxDeductions ?? 0,
  });
  const [ctxDirty, setCtxDirty] = useState(false);
  const [ctxSaved, setCtxSaved] = useState(false);
  const [ctxLocalError, setCtxLocalError] = useState('');

  // Sync form from server when context first loads — but never overwrite unsaved edits.
  useEffect(() => {
    if (profileContext && !ctxDirty) {
      setCtxForm({
        birthDate: profileContext.birthDate ?? '',
        stateCode: profileContext.stateCode ?? '',
        taxFilingStatus: profileContext.taxFilingStatus,
        qualifyingChildren: profileContext.qualifyingChildren,
        otherDependents: profileContext.otherDependents,
        spouseHasIncome: profileContext.spouseHasIncome,
        additionalAnnualIncome: profileContext.additionalAnnualIncome,
        annualPreTaxDeductions: profileContext.annualPreTaxDeductions,
      });
    }
  }, [profileContext, ctxDirty]);

  const handleCtxSave = async () => {
    if (ctxForm.birthDate) {
      const parsed = new Date(`${ctxForm.birthDate}T00:00:00Z`);
      const today = new Date();
      if (!Number.isFinite(parsed.getTime())) { setCtxLocalError('Enter a valid date (YYYY-MM-DD).'); return; }
      if (parsed > today) { setCtxLocalError('Date of birth cannot be in the future.'); return; }
      const age = today.getUTCFullYear() - parsed.getUTCFullYear();
      if (age < 18 || age > 120) { setCtxLocalError('Age must be between 18 and 120.'); return; }
    }
    setCtxLocalError('');
    try {
      await saveProfileContext({
        birthDate: ctxForm.birthDate || null,
        stateCode: (ctxForm.stateCode || null) as any,
        taxFilingStatus: ctxForm.taxFilingStatus as any,
        qualifyingChildren: Number(ctxForm.qualifyingChildren),
        otherDependents: Number(ctxForm.otherDependents),
        spouseHasIncome: ctxForm.spouseHasIncome,
        additionalAnnualIncome: Number(ctxForm.additionalAnnualIncome),
        annualPreTaxDeductions: Number(ctxForm.annualPreTaxDeductions),
      });
      setCtxDirty(false);
      setCtxSaved(true);
      setTimeout(() => setCtxSaved(false), 2500);
    } catch {
      // Error surfaced via profileContextError from store
    }
  };

  const setCtx = <K extends keyof typeof ctxForm>(key: K, value: (typeof ctxForm)[K]) => {
    setCtxForm(f => ({ ...f, [key]: value }));
    setCtxDirty(true);
  };

  // Group change records by source document, newest first
  const importGroups = React.useMemo(() => {
    const groups: Record<string, FinancialChangeRecord[]> = {};
    for (const rec of changeHistory) {
      if (!groups[rec.sourceDocumentId]) groups[rec.sourceDocumentId] = [];
      groups[rec.sourceDocumentId].push(rec);
    }
    return Object.entries(groups)
      .map(([docId, records]) => ({ docId, records, filename: records[0].sourceFilename, timestamp: records[0].timestamp }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [changeHistory]);

  const [form, setForm] = useState({
    name: profile?.name ?? '',
    hourlyRate: profile?.hourlyRate ?? 0,
    payFrequency: (profile?.payFrequency ?? 'Weekly') as PayFrequency,
    filingContext: (profile?.filingContext ?? 'Single') as FilingContext,
    birthDate: profile?.birthDate ?? '',
  });
  const [birthDateError, setBirthDateError] = useState('');

  const handleSave = () => {
    // Validate birthDate if supplied.
    if (form.birthDate) {
      const today = new Date();
      const parsed = new Date(`${form.birthDate}T00:00:00Z`);
      if (!Number.isFinite(parsed.getTime())) {
        setBirthDateError('Enter a valid date (YYYY-MM-DD).');
        return;
      }
      if (parsed > today) {
        setBirthDateError('Date of birth cannot be in the future.');
        return;
      }
      const age = today.getUTCFullYear() - parsed.getUTCFullYear();
      if (age < 18 || age > 120) {
        setBirthDateError('Age must be between 18 and 120.');
        return;
      }
    }
    setBirthDateError('');
    updateProfile({
      name: form.name,
      hourlyRate: Number(form.hourlyRate),
      payFrequency: form.payFrequency,
      filingContext: form.filingContext,
      birthDate: form.birthDate || undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // ── Export ──────────────────────────────────────────────────────────────────

  const handleExport = () => {
    try {
      const raw = localStorage.getItem('bcf_state') ?? '{}';
      const blob = new Blob([raw], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `blue-collar-fi-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Export failed. Please try again.');
    }
  };

  // ── Import ──────────────────────────────────────────────────────────────────

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportMsg('');
    setImportError('');
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const parsed = JSON.parse(text);

        // Basic validation
        if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid file format.');
        const hasProfile = 'profile' in parsed;
        const hasData = 'paystubs' in parsed || 'debts' in parsed || 'bills' in parsed;
        if (!hasProfile && !hasData) throw new Error('File does not appear to be a Blue Collar FI backup.');

        localStorage.setItem('bcf_state', text);
        setImportMsg('Import successful! Reloading…');
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Import failed — file may be corrupted or invalid.');
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be re-imported
    e.target.value = '';
  };

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">Manage your profile, data, and privacy.</p>
      </div>

      {/* Profile */}
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="w-5 h-5 text-primary" /> Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>First Name</Label>
            <Input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="h-12"
              placeholder="Your name"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Hourly Rate ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.hourlyRate}
                onChange={e => setForm(f => ({ ...f, hourlyRate: Number(e.target.value) }))}
                className="h-12"
              />
            </div>
            <div className="space-y-1">
              <Label>Pay Frequency</Label>
              <Select value={form.payFrequency} onValueChange={v => setForm(f => ({ ...f, payFrequency: v as PayFrequency }))}>
                <SelectTrigger className="h-12"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Weekly">Weekly</SelectItem>
                  <SelectItem value="Bi-Weekly">Bi-Weekly</SelectItem>
                  <SelectItem value="Semi-Monthly">Semi-Monthly</SelectItem>
                  <SelectItem value="Monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Tax Filing Status</Label>
            <Select value={form.filingContext} onValueChange={v => setForm(f => ({ ...f, filingContext: v as FilingContext }))}>
              <SelectTrigger className="h-12"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Single">Single</SelectItem>
                <SelectItem value="Married">Married</SelectItem>
                <SelectItem value="Head of Household">Head of Household</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Date of Birth <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              type="date"
              value={form.birthDate}
              onChange={e => { setForm(f => ({ ...f, birthDate: e.target.value })); setBirthDateError(''); }}
              className="h-12"
              max={new Date().toISOString().split('T')[0]}
            />
            {birthDateError && (
              <p className="text-xs text-destructive mt-1">{birthDateError}</p>
            )}
            <p className="text-xs text-muted-foreground">Used to compare your finances against national medians for your age group.</p>
          </div>
          <Button
            className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={handleSave}
          >
            {saved ? (
              <><CheckCircle2 className="w-4 h-4 mr-2" /> Saved!</>
            ) : (
              'Save Profile'
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Tax & State Context */}
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="w-5 h-5 text-primary" /> Tax &amp; State Context
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Used for age benchmarks, the tax estimator, and overtime analysis. All fields are optional — add what you have now and update later.
          </p>

          {/* Birth date */}
          <div className="space-y-1">
            <Label>Date of Birth <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              type="date"
              value={ctxForm.birthDate}
              max={new Date().toISOString().split('T')[0]}
              onChange={e => { setCtx('birthDate', e.target.value); setCtxLocalError(''); }}
              className="h-12"
            />
            {ctxLocalError && <p className="text-xs text-destructive">{ctxLocalError}</p>}
            <p className="text-xs text-muted-foreground">Age 18–120 · YYYY-MM-DD · Not in the future</p>
          </div>

          {/* State */}
          <div className="space-y-1">
            <Label>State <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Select value={ctxForm.stateCode || '__none__'} onValueChange={v => setCtx('stateCode', v === '__none__' ? '' : v)}>
              <SelectTrigger className="h-12"><SelectValue placeholder="Select state…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Not specified —</SelectItem>
                {US_STATE_CODES.map(code => (
                  <SelectItem key={code} value={code}>{code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">State income tax is currently supported for Oklahoma only.</p>
          </div>

          {/* Tax filing status */}
          <div className="space-y-1">
            <Label>Tax Filing Status</Label>
            <Select value={ctxForm.taxFilingStatus} onValueChange={v => setCtx('taxFilingStatus', v)}>
              <SelectTrigger className="h-12"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TAX_FILING_STATUSES.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dependents */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Qualifying Children</Label>
              <Input
                type="number"
                min={0} max={20}
                value={ctxForm.qualifyingChildren}
                onChange={e => setCtx('qualifyingChildren', Math.min(20, Math.max(0, Number(e.target.value))))}
                className="h-12"
              />
            </div>
            <div className="space-y-1">
              <Label>Other Dependents</Label>
              <Input
                type="number"
                min={0} max={20}
                value={ctxForm.otherDependents}
                onChange={e => setCtx('otherDependents', Math.min(20, Math.max(0, Number(e.target.value))))}
                className="h-12"
              />
            </div>
          </div>

          {/* Spouse has income */}
          <div className="flex items-center gap-3 py-1">
            <Checkbox
              id="spouseHasIncome"
              checked={ctxForm.spouseHasIncome}
              onCheckedChange={v => setCtx('spouseHasIncome', Boolean(v))}
              className="w-5 h-5"
            />
            <Label htmlFor="spouseHasIncome" className="cursor-pointer font-normal">Spouse / partner also has income</Label>
          </div>

          {/* Additional income & pretax deductions */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Additional Annual Income ($)</Label>
              <Input
                type="number"
                min={0}
                value={ctxForm.additionalAnnualIncome}
                onChange={e => setCtx('additionalAnnualIncome', Math.max(0, Number(e.target.value)))}
                className="h-12"
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">Side income, rental, etc.</p>
            </div>
            <div className="space-y-1">
              <Label>Annual Pre-Tax Deductions ($)</Label>
              <Input
                type="number"
                min={0}
                value={ctxForm.annualPreTaxDeductions}
                onChange={e => setCtx('annualPreTaxDeductions', Math.max(0, Number(e.target.value)))}
                className="h-12"
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">401k, HSA, etc.</p>
            </div>
          </div>

          {/* Server error */}
          {profileContextError && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {profileContextError}
            </div>
          )}

          <Button
            className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={handleCtxSave}
            disabled={profileContextSaving}
          >
            {ctxSaved
              ? <><CheckCircle2 className="w-4 h-4 mr-2" /> Saved!</>
              : profileContextSaving
              ? 'Saving…'
              : 'Save Tax Context'}
          </Button>
        </CardContent>
      </Card>

      {/* Export / Import */}
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="w-5 h-5 text-primary" /> Backup &amp; Restore
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Your data lives in this browser. Export a JSON backup you can restore later — or move to another device.
          </p>

          <Button
            variant="outline"
            className="w-full h-12 justify-between"
            onClick={handleExport}
          >
            <span className="flex items-center gap-2">
              <Download className="w-4 h-4 text-primary" /> Export my data as JSON
            </span>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </Button>

          <input
            ref={importRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
          <Button
            variant="outline"
            className="w-full h-12 justify-between"
            onClick={() => importRef.current?.click()}
          >
            <span className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary" /> Import from backup
            </span>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </Button>

          {importMsg && (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> {importMsg}
            </div>
          )}
          {importError && (
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {importError}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            ⚠️ Importing a backup will overwrite all current data.
          </p>
        </CardContent>
      </Card>

      {/* Privacy */}
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="w-5 h-5 text-primary" /> Privacy &amp; Data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-accent rounded-xl p-4 flex gap-3">
            <Shield className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold text-foreground">Stored only in this browser</div>
              <div className="text-muted-foreground mt-1">
                All your confirmed data is saved in localStorage on this device only. Document uploads are processed server-side by AI and immediately discarded — originals are never stored.
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            className="w-full h-12 justify-between"
            onClick={() => { resetToDemo(); setLocation('/dashboard'); }}
          >
            <span className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-primary" /> Load Demo Data
            </span>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </Button>
        </CardContent>
      </Card>

      {/* Import History */}
      {importGroups.length > 0 && (
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="w-5 h-5 text-primary" /> Import History
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {importGroups.length} import{importGroups.length !== 1 ? 's' : ''} recorded. Undo reverses all changes from that import.
            </p>

            {/* Undo last import shortcut */}
            <Button
              variant="outline"
              className="w-full h-11 justify-between text-sm"
              onClick={() => undoImport(importGroups[0].docId)}
            >
              <span className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-amber-600" />
                Undo last import ({importGroups[0].filename})
              </span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </Button>

            {/* Expandable full list */}
            <button
              className="flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={() => setShowHistory(h => !h)}
            >
              {showHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {showHistory ? 'Hide' : 'Show'} all imports
            </button>

            {showHistory && (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {importGroups.map(({ docId, filename, timestamp, records }) => (
                  <div key={docId} className="border border-border rounded-xl overflow-hidden">
                    <div
                      className="flex items-center justify-between p-3 cursor-pointer hover:bg-accent transition-colors"
                      onClick={() => setExpandedImport(expandedImport === docId ? null : docId)}
                    >
                      <div>
                        <div className="text-sm font-medium truncate max-w-[200px]">{filename}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(timestamp).toLocaleString()} · {records.length} change{records.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="text-xs px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 transition-colors"
                          onClick={e => { e.stopPropagation(); undoImport(docId); }}
                        >
                          Undo
                        </button>
                        {expandedImport === docId
                          ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                          : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                      </div>
                    </div>

                    {expandedImport === docId && (
                      <div className="border-t border-border divide-y divide-border">
                        {records.map(rec => (
                          <div key={rec.id} className="flex items-center justify-between px-3 py-2 bg-background">
                            <div className="text-xs">
                              <span className="font-medium capitalize">{rec.field}</span>
                              {rec.field !== 'created' && (
                                <span className="text-muted-foreground ml-1">
                                  {rec.oldValue != null ? `${rec.oldValue} → ${rec.newValue}` : `set to ${rec.newValue}`}
                                </span>
                              )}
                              {rec.field === 'created' && (
                                <span className="text-muted-foreground ml-1">Created in {rec.destinationSection}</span>
                              )}
                            </div>
                            {rec.field !== 'created' && rec.oldValue != null && (
                              <button
                                className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 transition-colors ml-2 flex-shrink-0"
                                onClick={() => restoreFieldValue(rec.id)}
                              >
                                Restore
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Danger Zone */}
      <Card className="border-destructive/30 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <AlertTriangle className="w-5 h-5" /> Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!showClearConfirm ? (
            <Button
              variant="outline"
              className="w-full h-12 border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => setShowClearConfirm(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Clear All My Data
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 text-sm text-destructive">
                This permanently deletes all your paystubs, debts, bills, assets, and profile. This cannot be undone. Export a backup first if you want to keep it.
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-12" onClick={() => setShowClearConfirm(false)}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 h-12 bg-destructive hover:bg-destructive/90 text-white"
                  onClick={() => { clearAll(); setShowClearConfirm(false); setLocation('/welcome'); }}
                >
                  Yes, Delete Everything
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-center text-xs text-muted-foreground pb-4">
        Blue Collar Financial AI<br />
        Not a licensed financial adviser. Always verify extracted values and consult a professional for major decisions.
      </div>
    </div>
  );
}
