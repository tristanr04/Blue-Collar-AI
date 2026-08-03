import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { Shield, Trash2, RefreshCw, User, Lock, AlertTriangle, ChevronRight } from 'lucide-react';
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

  const [form, setForm] = useState({
    name: profile?.name ?? '',
    hourlyRate: profile?.hourlyRate ?? 0,
    payFrequency: profile?.payFrequency ?? ('Weekly' as PayFrequency),
    filingContext: profile?.filingContext ?? ('Single' as FilingContext),
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

  const handleLoadDemo = () => {
    resetToDemo();
    setLocation('/dashboard');
  };

  const handleClearAll = () => {
    clearAll();
    setShowClearConfirm(false);
    setLocation('/welcome');
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
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-12" placeholder="Your name" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Hourly Rate ($)</Label>
              <Input type="number" step="0.01" value={form.hourlyRate} onChange={e => setForm(f => ({ ...f, hourlyRate: Number(e.target.value) }))} className="h-12" />
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
          <Button className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleSave}>
            {saved ? 'Saved!' : 'Save Profile'}
          </Button>
        </CardContent>
      </Card>

      {/* Privacy */}
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="w-5 h-5 text-primary" /> Privacy & Data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-accent rounded-xl p-4 flex gap-3">
            <Shield className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold text-foreground">100% local storage</div>
              <div className="text-muted-foreground mt-1">
                All your data — pay history, bills, debts — is saved only in this browser on this device. Nothing is sent to any server. Clearing your browser data will permanently delete it.
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Button variant="outline" className="w-full h-12 justify-between" onClick={handleLoadDemo}>
              <span className="flex items-center gap-2"><RefreshCw className="w-4 h-4 text-primary" /> Load Demo Data</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </Button>
          </div>
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
            <Button variant="outline" className="w-full h-12 border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setShowClearConfirm(true)}>
              <Trash2 className="w-4 h-4 mr-2" /> Clear All My Data
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 text-sm text-destructive">
                This permanently deletes all your paystubs, debts, bills, and profile. This cannot be undone.
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-12" onClick={() => setShowClearConfirm(false)}>Cancel</Button>
                <Button className="flex-1 h-12 bg-destructive hover:bg-destructive/90 text-white" onClick={handleClearAll}>
                  Yes, Delete Everything
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-center text-xs text-muted-foreground pb-4">
        Blue Collar Financial AI — Prototype v1.0<br />
        Not a licensed financial advisor. Always verify extracted values and consult a professional for major decisions.
      </div>
    </div>
  );
}
