import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { Check, X, ShieldAlert, FileText, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/lib/store';

export default function DocumentsReview() {
  const [_, setLocation] = useLocation();
  const { documents, updateDocument, addPaystub } = useStore();
  
  // Find first pending doc
  const docToReview = documents.find(d => d.status === 'Pending Review');
  
  const [formData, setFormData] = useState<Record<string, string>>(docToReview?.data || {});

  if (!docToReview) {
    return (
      <div className="p-8 text-center max-w-md mx-auto mt-12">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Check className="w-8 h-8 text-emerald-600" />
        </div>
        <h2 className="text-2xl font-bold mb-2">All caught up!</h2>
        <p className="text-slate-500 mb-6">No documents currently need your review.</p>
        <Button onClick={() => setLocation('/dashboard')}>Return to Dashboard</Button>
      </div>
    );
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    if (docToReview.type === 'Paystub') {
      addPaystub({
        employer: formData.employer,
        date: formData.date || new Date().toISOString(),
        regularHours: Number(formData.regularHours),
        overtimeHours: Number(formData.overtimeHours),
        doubleTimeHours: Number(formData.doubleTimeHours),
        perDiem: Number(formData.perDiem),
        grossPay: Number(formData.grossPay),
        taxes: Number(formData.taxes),
        deductions: Number(formData.deductions),
        netPay: Number(formData.netPay),
      });
    }

    updateDocument(docToReview.id, { status: 'Processed' });
    setLocation('/documents');
  };

  const handleDiscard = () => {
    updateDocument(docToReview.id, { status: 'Rejected' });
    setLocation('/documents');
  };

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation('/documents')}>
          <X className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Review Extraction</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Please confirm these details match your screenshot.</p>
        </div>
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-xl p-4 flex gap-3 text-amber-800 dark:text-amber-200">
        <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <strong>This is a best-effort estimate.</strong> Nothing is saved until you confirm. Please correct any values that were misread.
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center">
          <div className="flex items-center gap-2 font-medium">
            <FileText className="w-4 h-4 text-emerald-600" />
            {docToReview.type} Data
          </div>
          <div className="text-xs font-medium px-2 py-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-md flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> High Confidence
          </div>
        </div>
        
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Employer</Label>
              <Input 
                value={formData.employer || ''} 
                onChange={e => handleInputChange('employer', e.target.value)}
                className="bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input 
                type="date"
                value={formData.date || ''} 
                onChange={e => handleInputChange('date', e.target.value)}
                className="bg-slate-50 dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <h4 className="text-sm font-semibold mb-3 text-slate-900 dark:text-slate-100">Hours & Earnings</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <Label>Regular Hrs</Label>
                <Input type="number" value={formData.regularHours || 0} onChange={e => handleInputChange('regularHours', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Overtime Hrs</Label>
                <Input type="number" value={formData.overtimeHours || 0} onChange={e => handleInputChange('overtimeHours', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Double Time</Label>
                <Input type="number" value={formData.doubleTimeHours || 0} onChange={e => handleInputChange('doubleTimeHours', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Per Diem ($)</Label>
                <Input type="number" value={formData.perDiem || 0} onChange={e => handleInputChange('perDiem', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <h4 className="text-sm font-semibold mb-3 text-slate-900 dark:text-slate-100">Totals</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <Label>Gross Pay</Label>
                <Input type="number" value={formData.grossPay || 0} onChange={e => handleInputChange('grossPay', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Taxes</Label>
                <Input type="number" value={formData.taxes || 0} onChange={e => handleInputChange('taxes', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Deductions</Label>
                <Input type="number" value={formData.deductions || 0} onChange={e => handleInputChange('deductions', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-emerald-700 dark:text-emerald-400 font-bold">Net Pay</Label>
                <Input type="number" className="font-bold border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-900 dark:text-emerald-100" value={formData.netPay || 0} onChange={e => handleInputChange('netPay', e.target.value)} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 h-12" onClick={handleDiscard}>
          Discard
        </Button>
        <Button className="flex-2 w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white text-lg" onClick={handleSave}>
          Confirm & Save <ArrowRight className="w-5 h-5 ml-2" />
        </Button>
      </div>
    </div>
  );
}
