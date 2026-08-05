import { useMemo, useState } from 'react';
import { Check, ChevronRight, Flame, RefreshCw } from 'lucide-react';
import { useLocation } from 'wouter';
import {
  getCheckInProgress,
  loadRetentionState,
  MonthlyCheckInKey,
  setCheckInItem,
} from '@/lib/retention';

const tasks: Array<{
  key: MonthlyCheckInKey;
  label: string;
  detail: string;
  href: string;
}> = [
  {
    key: 'scan',
    label: 'Update your documents',
    detail: 'Scan this month’s newest statements and pay records.',
    href: '/scanner',
  },
  {
    key: 'reviewBills',
    label: 'Review recurring bills',
    detail: 'Confirm amounts and catch changes before they surprise you.',
    href: '/bills',
  },
  {
    key: 'reviewDebt',
    label: 'Check debt progress',
    detail: 'Update balances and minimum payments.',
    href: '/debts',
  },
  {
    key: 'reviewInvestments',
    label: 'Refresh investments',
    detail: 'Keep retirement and brokerage balances current.',
    href: '/investments',
  },
];

export function MonthlyCheckIn() {
  const [, setLocation] = useLocation();
  const [state, setState] = useState(loadRetentionState);
  const progress = useMemo(() => getCheckInProgress(state), [state]);

  const toggle = (key: MonthlyCheckInKey) => {
    setState(current => setCheckInItem(current, key, !current.completed[key]));
  };

  return (
    <section className="rounded-3xl border border-blue-400/20 bg-[linear-gradient(145deg,rgba(20,35,60,0.72),rgba(7,16,29,0.96))] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-blue-300">
            <RefreshCw className="h-4 w-4" /> Monthly money check-in
          </div>
          <h2 className="mt-2 text-lg font-semibold text-white">
            Keep your financial picture current
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Complete these four steps each month so your dashboard and AI guidance stay useful.
          </p>
        </div>
        <div className="rounded-2xl border border-orange-400/20 bg-orange-500/10 px-3 py-2 text-center">
          <div className="flex items-center justify-center gap-1 text-sm font-semibold text-orange-300">
            <Flame className="h-4 w-4" /> {state.streakMonths}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-orange-200/60">month streak</div>
        </div>
      </div>

      <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>{progress.completed} of {progress.total} complete</span>
        <span>{progress.percent}%</span>
      </div>

      <div className="mt-4 space-y-2">
        {tasks.map(task => {
          const done = state.completed[task.key];
          return (
            <div
              key={task.key}
              className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/20 p-3"
            >
              <button
                type="button"
                onClick={() => toggle(task.key)}
                aria-label={`${done ? 'Mark incomplete' : 'Mark complete'}: ${task.label}`}
                className={done
                  ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white'
                  : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-transparent'}
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setLocation(task.href)}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
              >
                <span className="min-w-0">
                  <span className={done ? 'block font-medium text-slate-400 line-through' : 'block font-medium text-white'}>
                    {task.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">{task.detail}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
              </button>
            </div>
          );
        })}
      </div>

      {progress.isComplete && (
        <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          Monthly check-in complete. Your dashboard is current and your streak will advance next month.
        </div>
      )}
    </section>
  );
}
