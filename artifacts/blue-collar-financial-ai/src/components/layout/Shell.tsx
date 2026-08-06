import React from 'react';
import { Link, useLocation } from 'wouter';
import {
  Home, ScanLine, WalletCards, Sparkles, Menu, Settings,
  FileText, TrendingDown, Receipt, Landmark, ChartNoAxesCombined,
  Calculator, Loader2, HardHat, ShieldCheck, Banknote, Target, Users, History, Activity, CalendarDays, CreditCard, Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useJobQueue } from '@/lib/jobQueue';

const navItems = [
  { href: '/dashboard', label: 'Command Center', icon: Home },
  { href: '/scanner', label: 'Scan Documents', icon: ScanLine },
  { href: '/paystubs', label: 'Paystubs', icon: FileText },
  { href: '/debts', label: 'Debt', icon: TrendingDown },
  { href: '/bills', label: 'Bills', icon: Receipt },
  { href: '/banking', label: 'Banking', icon: Landmark },
  { href: '/investments', label: 'Investments', icon: ChartNoAxesCombined },
  { href: '/scenario', label: 'Scenarios', icon: Calculator },
  { href: '/tax-estimator', label: 'Tax Estimator', icon: Banknote },
  { href: '/age-progress', label: 'Age Progress', icon: Target },
  { href: '/growth', label: 'Growth Hub', icon: Users },
  { href: '/goals', label: 'Goals', icon: Target },
  { href: '/workspaces', label: 'Workspaces', icon: Building2 },
  { href: '/timeline', label: 'Timeline', icon: History },
  { href: '/health-score', label: 'Health Score', icon: Activity },
  { href: '/weekly-snapshot', label: 'Weekly', icon: CalendarDays },
  { href: '/ask-ai', label: 'AI Copilot', icon: Sparkles },
  { href: '/pricing', label: 'Pricing & Plans', icon: CreditCard },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { isActive, activeCount } = useJobQueue();

  if (
    location === '/welcome' ||
    location === '/onboarding' ||
    location === '/' ||
    location.startsWith('/scanner')
  ) {
    return <div className="bc-app-shell">{children}</div>;
  }

  const mobileItems = [
    { href: '/dashboard', icon: Home, label: 'Home' },
    { href: '/scanner', icon: ScanLine, label: 'Scanner' },
    { href: '/banking', icon: WalletCards, label: 'Accounts' },
    { href: '/ask-ai', icon: Sparkles, label: 'AI Copilot' },
    { href: '/settings', icon: Menu, label: 'More' },
  ];

  return (
    <div className="bc-app-shell flex min-h-[100dvh] w-full">
      <aside className="hidden md:flex fixed inset-y-0 z-50 w-72 flex-col border-r border-blue-500/10 bg-[#07111f]/95 backdrop-blur-xl">
        <div className="flex items-center gap-3 border-b border-blue-500/10 px-5 py-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-blue-400/30 bg-blue-500/10 text-blue-400">
            <HardHat className="h-6 w-6" />
          </div>
          <div>
            <div className="font-black tracking-wide text-white">BLUE COLLAR <span className="text-cyan-400">AI</span></div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Financial Command Center</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = location.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={cn(
                'group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-all',
                active
                  ? 'border border-blue-400/25 bg-blue-500/15 text-blue-300 shadow-[inset_3px_0_0_#3b82f6]'
                  : 'border border-transparent text-slate-400 hover:bg-white/5 hover:text-white'
              )}>
                <Icon className={cn('h-5 w-5', active ? 'text-blue-400' : 'text-slate-500 group-hover:text-cyan-400')} />
                {item.label}
                {item.href === '/scanner' && isActive && (
                  <span className="ml-auto flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
                    <Loader2 className="h-3 w-3 animate-spin" />{activeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-blue-500/10 p-3">
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">
            <ShieldCheck className="h-4 w-4" /> Private & secure
          </div>
          <Link href="/settings" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-slate-400 hover:bg-white/5 hover:text-white">
            <Settings className="h-5 w-5" /> Settings
          </Link>
        </div>
      </aside>

      <main className="flex min-h-[100dvh] flex-1 flex-col pb-20 md:pb-0 md:pl-72">
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-blue-500/10 bg-[#07111f]/90 px-4 py-3 backdrop-blur-xl md:hidden">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-blue-400/25 bg-blue-500/10 text-blue-400">
              <HardHat className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-black tracking-wide text-white">BLUE COLLAR <span className="text-cyan-400">AI</span></div>
              <div className="text-[9px] uppercase tracking-[0.18em] text-slate-500">Command Center</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isActive && (
              <div className="flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                <Loader2 className="h-3 w-3 animate-spin" /> {activeCount}
              </div>
            )}
            <Link href="/settings" className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-400 hover:text-white">
              <Settings className="h-5 w-5" />
            </Link>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-50 flex items-center border-t border-blue-500/15 bg-[#07111f]/95 px-1 pb-safe backdrop-blur-xl md:hidden">
        {mobileItems.map((item) => {
          const Icon = item.icon;
          const active = location.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={cn(
              'relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors',
              active ? 'text-blue-400' : 'text-slate-500'
            )}>
              {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-blue-500" />}
              <Icon className={cn('h-5 w-5', active && 'drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]')} />
              <span>{item.label}</span>
              {item.href === '/scanner' && isActive && <span className="absolute right-[24%] top-2 h-2 w-2 rounded-full bg-emerald-400" />}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
