import React, { useState, useRef } from 'react';
import { useLocation } from 'wouter';
import {
  Shield, Trash2, RefreshCw, User, Lock, AlertTriangle,
  ChevronRight, Download, Upload, CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useStore, PayFrequency, FilingContext } from '@/lib/store';

export default function Settings() {
  const [_, setLocation] = useLocation();
  const { profile, updateProfile, resetToDemo, clearAll } = useStore();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [saved, setSaved] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [importError, setImportError] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: profile?.name ?? '',
    hourlyRate: profile?.hourlyRate ?? 0,
    payFrequency: (profile?.payFrequency ?? 'Weekly') as PayFrequency,
    filingContext: (profile?.filingContext ?? 'Single') as FilingContext,
  });

  const handleSave = () => {
    updateProfile({
      name: form.name,
      hourlyRate: Number(form.hourlyRate),
      payFrequency: form.payFrequency,
      filingContext: form.filingContext,
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
