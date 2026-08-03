import React from 'react';
import { Link, useLocation } from 'wouter';
import {
  Home, FileText, TrendingUp, CreditCard, Briefcase,
  PieChart, Calculator, Settings, Sparkles, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useJobQueue } from '@/lib/jobQueue';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/paystubs', label: 'Paystubs', icon: FileText },
  { href: '/debts', label: 'Debts', icon: TrendingUp },
  { href: '/bills', label: 'Bills', icon: CreditCard },
  { href: '/banking', label: 'Banking', icon: Briefcase },
  { href: '/investments', label: 'Investments', icon: PieChart },
  { href: '/scenario', label: 'Scenarios', icon: Calculator },
  { href: '/ask-ai', label: 'Ask Blue Collar AI', icon: Sparkles },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { isActive, activeCount, jobs } = useJobQueue();

  // Full-screen routes — no nav
  if (
    location === '/welcome' ||
    location === '/onboarding' ||
    location === '/' ||
    location.startsWith('/scanner')
  ) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-[100dvh] w-full bg-slate-50 dark:bg-slate-950">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 fixed inset-y-0 z-50">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold shadow-sm">
            B
          </div>
          <span className="font-semibold text-slate-900 dark:text-white">Blue Collar FI</span>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.startsWith(item.href);
            const isAI = item.href === '/ask-ai';
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? isAI
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                    : isAI
                    ? 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50'
                )}
              >
                <Icon className={cn('w-5 h-5 flex-shrink-0', isAI && !isActive && 'text-emerald-600 dark:text-emerald-400')} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800">
          <Link
            href="/settings"
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              location === '/settings'
                ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-50'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50'
            )}
          >
            <Settings className="w-5 h-5" />
            Settings
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col md:pl-64 min-h-[100dvh] pb-16 md:pb-0">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-emerald-600 flex items-center justify-center text-white font-bold text-sm">B</div>
            <span className="font-semibold text-slate-900 dark:text-white text-sm">Blue Collar FI</span>
          </div>
          <div className="flex items-center gap-1">
            {isActive && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>{activeCount}</span>
              </div>
            )}
            <Link href="/ask-ai" className="p-2 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg">
              <Sparkles className="w-5 h-5" />
            </Link>
            <Link href="/settings" className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 rounded-lg">
              <Settings className="w-5 h-5" />
            </Link>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Nav — 5 tabs */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-around pb-safe z-50">
        {[
          { href: '/dashboard', icon: Home, label: 'Home' },
          { href: '/paystubs', icon: FileText, label: 'Pay' },
          { href: '/debts', icon: TrendingUp, label: 'Debts' },
          { href: '/ask-ai', icon: Sparkles, label: 'Ask AI' },
          { href: '/scenario', icon: Calculator, label: 'Tools' },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = location.startsWith(item.href);
          const isAI = item.href === '/ask-ai';
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center w-full py-2 gap-0.5 transition-colors',
                isActive
                  ? isAI ? 'text-emerald-600 dark:text-emerald-400' : 'text-emerald-600 dark:text-emerald-400'
                  : isAI
                  ? 'text-emerald-500 dark:text-emerald-600'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50'
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
