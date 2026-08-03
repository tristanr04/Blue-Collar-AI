import React, { useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { UploadCloud, FileText, CheckCircle2, AlertCircle, ShieldAlert, ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useStore } from '@/lib/store';

export default function Documents() {
  const [_, setLocation] = useLocation();
  const { documents, addDocument } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleSimulateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    setIsUploading(true);
    
    // Simulate AI extraction delay
    setTimeout(() => {
      // Simulate extracted data for a paystub
      const mockExtractedData = {
        employer: 'United Construction',
        date: new Date().toISOString().split('T')[0],
        regularHours: 40,
        overtimeHours: 12,
        doubleTimeHours: 0,
        perDiem: 150,
        grossPay: 2040,
        taxes: 420,
        deductions: 130,
        netPay: 1490
      };

      addDocument({
        type: 'Paystub',
        status: 'Pending Review',
        data: mockExtractedData
      });
      
      setIsUploading(false);
      setLocation('/documents/review');
    }, 1500);
  };

  const pendingDocs = documents.filter(d => d.status === 'Pending Review');
  const processedDocs = documents.filter(d => d.status === 'Processed');

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Document Scanner</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">Upload screenshots of paystubs or bills to extract details automatically.</p>
      </div>

      <div className="bg-slate-100 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-800 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white text-sm">Processed locally, never shared</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Images are analyzed entirely on your device. We do not store your images or send them to any external servers. 
            All extractions are estimates and require your manual confirmation.
          </p>
        </div>
      </div>

      <Card className="border-dashed border-2 bg-slate-50/50 dark:bg-slate-900/50">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center mb-4">
            <UploadCloud className="w-8 h-8 text-slate-500 dark:text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Upload Screenshots</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mb-6">
            Take a picture or upload a screenshot of your paystub, W2, or bill.
          </p>
          
          <input 
            type="file" 
            accept="image/*" 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleSimulateUpload}
          />
          
          <Button 
            size="lg" 
            className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[200px]"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? 'Extracting details...' : 'Select Image'}
          </Button>
        </CardContent>
      </Card>

      {pendingDocs.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-slate-900 dark:text-white">Needs Review ({pendingDocs.length})</h3>
          {pendingDocs.map(doc => (
            <div key={doc.id} className="flex items-center justify-between p-4 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-900/30">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-500" />
                <div>
                  <div className="font-medium text-amber-900 dark:text-amber-100">{doc.type} Extraction</div>
                  <div className="text-xs text-amber-700 dark:text-amber-400">{new Date(doc.date).toLocaleString()}</div>
                </div>
              </div>
              <Button size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-100" onClick={() => setLocation('/documents/review')}>
                Review <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {processedDocs.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-slate-900 dark:text-white">Processed History</h3>
          {processedDocs.map(doc => (
            <div key={doc.id} className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <div>
                  <div className="font-medium text-slate-900 dark:text-white">{doc.type} Processed</div>
                  <div className="text-xs text-slate-500">{new Date(doc.date).toLocaleString()}</div>
                </div>
              </div>
              <Button size="icon" variant="ghost" className="text-slate-400 hover:text-slate-600">
                <FileText className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
