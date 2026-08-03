import React from 'react';
import { Link, useLocation } from 'wouter';
import { Shield, ArrowRight, ShieldCheck, Banknote, LineChart, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Welcome() {
  const [_, setLocation] = useLocation();

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-slate-900 text-slate-50 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-emerald-900/40 via-slate-900 to-slate-900 pointer-events-none" />
      
      <div className="flex-1 flex flex-col justify-center px-6 py-12 md:p-12 z-10 max-w-lg mx-auto w-full">
        <div className="mb-12">
          <div className="w-12 h-12 rounded-xl bg-emerald-600 flex items-center justify-center text-white font-bold text-2xl mb-6 shadow-lg shadow-emerald-900/50">
            B
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
            Financial tools <br />
            <span className="text-emerald-400">built for the trades.</span>
          </h1>
          <p className="text-lg text-slate-300 leading-relaxed mb-8">
            Manage variable pay, overtime, and bills in a private, secure dashboard. A capable copilot, not a generic banking app.
          </p>
        </div>

        <div className="space-y-4 mb-12">
          {[
            { icon: Banknote, text: 'Handle overtime and per diem correctly' },
            { icon: LineChart, text: 'Plan scenarios for extra shifts' },
            { icon: Lock, text: '100% local, private, and secure' },
          ].map((feature, i) => (
            <div key={i} className="flex items-center gap-3 text-slate-200">
              <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-emerald-400 flex-shrink-0">
                <feature.icon className="w-4 h-4" />
              </div>
              <span className="font-medium">{feature.text}</span>
            </div>
          ))}
        </div>

        <div className="mt-auto space-y-6">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex items-start gap-3 backdrop-blur-sm">
            <ShieldCheck className="w-6 h-6 text-emerald-500 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-white mb-1">Our Privacy Promise</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Your financial data never leaves your device. No cloud syncing, no data selling, no bank connections required.
              </p>
            </div>
          </div>
          
          <Button 
            size="lg" 
            className="w-full text-lg h-14 bg-emerald-600 hover:bg-emerald-700 text-white border-0"
            onClick={() => setLocation('/onboarding')}
          >
            Get Started <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
          
          <div className="text-center text-sm text-slate-500">
            Already have an account? <button className="text-emerald-400 font-medium hover:underline">Log in</button>
          </div>
        </div>
      </div>
    </div>
  );
}
