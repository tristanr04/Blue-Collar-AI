import React from 'react';
import { Link, useLocation } from 'wouter';
import { 
  Home, 
  FileText, 
  Briefcase, 
  CreditCard, 
  PieChart, 
  TrendingUp, 
  Calculator, 
  Settings 
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/paystubs', label: 'Paystubs', icon: FileText },
  { href: '/debts', label: 'Debts', icon: TrendingUp },
  { href: '/bills', label: 'Bills', icon: CreditCard },
  { href: '/banking', label: 'Banking', icon: Briefcase },
  { href: '/investments', label: 'Investments', icon: PieChart },
  { href: '/scenario', label: 'Scenarios', icon: Calculator },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  // Don't show shell on welcome or onboarding
  if (location === '/welcome' || location === '/onboarding' || location === '/' || location.startsWith('/scanner')) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-[100dvh] w-full bg-slate-50 dark:bg-slate-950">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 fixed inset-y-0 z-50">
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-emerald-600 flex items-center justify-center text-white font-bold">
            B
          </div>
          <span className="font-semibold text-lg text-slate-900 dark:text-white">Blue Collar FI</span>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.startsWith(item.href);
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" 
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50"
                )}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-200 dark:border-slate-800">
          <Link 
            href="/settings"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
              location === '/settings'
                ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-50"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-50"
            )}
          >
            <Settings className="w-5 h-5" />
            Settings
          </Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col md:pl-64 min-h-[100dvh] pb-16 md:pb-0">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-emerald-600 flex items-center justify-center text-white font-bold text-sm">
              B
            </div>
            <span className="font-semibold text-slate-900 dark:text-white">Blue Collar FI</span>
          </div>
          <Link href="/settings" className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
            <Settings className="w-5 h-5" />
          </Link>
        </header>

        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-around pb-safe z-50">
        {[
          { href: '/dashboard', icon: Home, label: 'Home' },
          { href: '/paystubs', icon: FileText, label: 'Pay' },
          { href: '/bills', icon: CreditCard, label: 'Bills' },
          { href: '/debts', icon: TrendingUp, label: 'Debts' },
          { href: '/scenario', icon: Calculator, label: 'Tools' },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = location.startsWith(item.href);
          return (
            <Link 
              key={item.href} 
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center w-full py-2 space-y-1",
                isActive 
                  ? "text-emerald-600 dark:text-emerald-400" 
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50"
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
