/**
 * MigrationDialog
 *
 * Shown when the user signs in for the first time and has local-only data that
 * has never been uploaded to the server. The user must explicitly confirm
 * before any data is sent. Nothing is migrated automatically.
 *
 * States: confirm → uploading → done | error
 *
 * Idempotency: the store's migrateLocalToServer generates a UUID key stored in
 * localStorage so that retries (from "Try again" or a page refresh mid-upload)
 * re-use the same key — the server returns the original result rather than
 * creating duplicate records.
 */
import React, { useState } from 'react';
import { Cloud, CheckCircle2, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/lib/store';

type Phase = 'confirm' | 'uploading' | 'done' | 'error';

export default function MigrationDialog() {
  const {
    migrationPending, dismissMigration, migrateLocalToServer,
    paystubs, debts, bills, assets,
  } = useStore();

  const [phase, setPhase] = useState<Phase>('confirm');
  const [errorMsg, setErrorMsg] = useState('');

  // Keep the modal visible during uploading / done / error even if the store
  // flag clears mid-flight.
  if (!migrationPending && phase === 'confirm') return null;

  const counts = [
    { label: 'Paystubs', count: paystubs.length, icon: '💵' },
    { label: 'Debts',    count: debts.length,    icon: '💳' },
    { label: 'Bills',    count: bills.length,     icon: '📄' },
    { label: 'Assets',   count: assets.length,    icon: '🏦' },
  ].filter(c => c.count > 0);

  const totalRecords = paystubs.length + debts.length + bills.length + assets.length;

  async function handleUpload() {
    setPhase('uploading');
    setErrorMsg('');
    try {
      await migrateLocalToServer();
      setPhase('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      setPhase('error');
    }
  }

  function handleSkip() {
    dismissMigration();
  }

  function handleDone() {
    dismissMigration();
    setPhase('confirm');
  }

  function handleRetry() {
    // The store already cleared the failed idempotency key, so the next
    // handleUpload call will generate a fresh one.
    setPhase('confirm');
    setErrorMsg('');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(2, 6, 23, 0.85)', backdropFilter: 'blur(4px)' }}
      aria-modal="true"
      role="dialog"
      aria-labelledby="migration-title"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-600/20 flex items-center justify-center">
              <Cloud className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 id="migration-title" className="text-lg font-semibold text-white">
                Save your data to the cloud
              </h2>
              <p className="text-sm text-slate-400">
                You have local data that isn't on the server yet
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">

          {/* ── Confirm ── */}
          {phase === 'confirm' && (
            <>
              <p className="text-sm text-slate-300 mb-4">
                The following records are stored only on this device. Upload them so your
                data is available everywhere and backed up securely.
              </p>

              <div className="bg-slate-800 rounded-xl p-4 mb-4 space-y-2">
                {counts.length === 0 ? (
                  <p className="text-sm text-slate-400">No records to upload.</p>
                ) : (
                  counts.map(({ label, count, icon }) => (
                    <div key={label} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-slate-300">
                        <span>{icon}</span> {label}
                      </span>
                      <span className="font-semibold text-white">
                        {count} record{count !== 1 ? 's' : ''}
                      </span>
                    </div>
                  ))
                )}
                <div className="border-t border-slate-700 pt-2 flex justify-between text-sm font-semibold">
                  <span className="text-slate-300">Total</span>
                  <span className="text-emerald-400">{totalRecords} records</span>
                </div>
              </div>

              <div className="flex items-start gap-2 text-xs text-slate-400 mb-5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                <span>
                  Your data is encrypted in transit and stored securely. Only you can
                  access it. Safe to retry — if interrupted, we'll resume without creating duplicates.
                </span>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
                  onClick={handleSkip}
                >
                  Skip for now
                </Button>
                <Button
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white"
                  onClick={handleUpload}
                  disabled={totalRecords === 0}
                >
                  <Cloud className="w-4 h-4 mr-2" />
                  Upload my data
                </Button>
              </div>
            </>
          )}

          {/* ── Uploading / polling ── */}
          {phase === 'uploading' && (
            <div className="flex flex-col items-center py-6 gap-4 text-center">
              <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
              <div>
                <p className="text-white font-medium">Uploading your data…</p>
                <p className="text-sm text-slate-400 mt-1">
                  Saving {totalRecords} record{totalRecords !== 1 ? 's' : ''} securely.
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  Safe to close — progress is tracked and will resume on re-open.
                </p>
              </div>
            </div>
          )}

          {/* ── Done ── */}
          {phase === 'done' && (
            <div className="flex flex-col items-center py-6 gap-4 text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-600/20 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </div>
              <div>
                <p className="text-white font-semibold text-lg">All done!</p>
                <p className="text-sm text-slate-400 mt-1">
                  {totalRecords} record{totalRecords !== 1 ? 's' : ''} uploaded successfully.
                  Your data is now synced across all your devices.
                </p>
              </div>
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white mt-2"
                onClick={handleDone}
              >
                Done
              </Button>
            </div>
          )}

          {/* ── Error ── */}
          {phase === 'error' && (
            <div className="flex flex-col items-center py-4 gap-4 text-center">
              <div className="w-14 h-14 rounded-full bg-red-600/20 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-400" />
              </div>
              <div>
                <p className="text-white font-semibold">Upload failed</p>
                <p className="text-sm text-slate-400 mt-1">{errorMsg}</p>
                <p className="text-xs text-slate-500 mt-2">
                  Your local data is unchanged — nothing was partially saved.
                </p>
              </div>
              <div className="flex gap-3 w-full">
                <Button
                  variant="outline"
                  className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
                  onClick={handleSkip}
                >
                  Skip for now
                </Button>
                <Button
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white"
                  onClick={handleRetry}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Try again
                </Button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
