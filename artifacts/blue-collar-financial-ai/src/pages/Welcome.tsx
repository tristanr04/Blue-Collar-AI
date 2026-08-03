import React from 'react';
import { useLocation } from 'wouter';
import { ScanLine, ArrowRight, ShieldCheck, Lock, Banknote, LineChart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/lib/store';

export default function Welcome() {
  const [_, setLocation] = useLocation();
  const { profile } = useStore();

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-secondary text-secondary-foreground relative overflow-hidden">
      {/* Background radial gradient */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="flex-1 flex flex-col px-6 py-10 md:p-12 z-10 max-w-lg mx-auto w-full">

        {/* Logo + headline */}
        <div className="mb-10">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-6 shadow-lg shadow-primary/30">
            <ScanLine className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white leading-tight mb-4">
            Your finances,<br />
            <span className="text-primary">finally clear.</span>
          </h1>
          <p className="text-lg text-secondary-foreground/70 leading-relaxed">
            Built for trade workers with variable pay — overtime, per diem, union jobs. Scan your documents and see the full picture in minutes.
          </p>
        </div>

        {/* Primary CTA — Scan */}
        <div className="space-y-4 mb-10">
          <Button
            size="lg"
            className="w-full h-16 text-xl font-bold bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl shadow-xl shadow-primary/30 flex items-center justify-center gap-3"
            onClick={() => setLocation('/scanner')}
          >
            <ScanLine className="w-6 h-6" />
            Scan My Finances
          </Button>
          <p className="text-center text-sm text-secondary-foreground/50">
            Upload screenshots of paystubs, bank accounts, credit cards &amp; more
          </p>
        </div>

        {/* Feature bullets */}
        <div className="space-y-3 mb-10">
          {[
            { icon: ScanLine, text: 'OCR reads your documents on-device' },
            { icon: Banknote, text: 'Handles overtime, double time, per diem' },
            { icon: LineChart, text: 'Scenario builder for extra shifts' },
            { icon: Lock, text: '100% private — no servers, no accounts' },
          ].map((f, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-primary flex-shrink-0">
                <f.icon className="w-4 h-4" />
              </div>
              <span className="text-secondary-foreground/80 font-medium">{f.text}</span>
            </div>
          ))}
        </div>

        {/* Privacy card */}
        <div className="bg-white/8 border border-white/12 rounded-2xl p-4 flex items-start gap-3 mb-8 backdrop-blur-sm">
          <ShieldCheck className="w-6 h-6 text-primary flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-white mb-1">Your data never leaves this device</h3>
            <p className="text-sm text-secondary-foreground/60 leading-relaxed">
              No cloud storage. No bank connections. No accounts required. Everything is saved locally in your browser.
            </p>
          </div>
        </div>

        {/* Secondary options */}
        <div className="space-y-3 mt-auto">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-secondary-foreground/40">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <Button
            variant="ghost"
            className="w-full h-12 text-secondary-foreground/70 hover:text-white hover:bg-white/10 border border-white/10 rounded-xl"
            onClick={() => setLocation('/onboarding')}
          >
            Set up profile manually <ArrowRight className="w-4 h-4 ml-2" />
          </Button>

          {profile?.hasCompletedOnboarding && (
            <Button
              variant="ghost"
              className="w-full h-12 text-secondary-foreground/70 hover:text-white hover:bg-white/10 rounded-xl"
              onClick={() => setLocation('/dashboard')}
            >
              Go to my dashboard
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
