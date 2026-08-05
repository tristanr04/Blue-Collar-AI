import { useMemo, useState } from 'react';
import {
  Award,
  Building2,
  Check,
  Copy,
  Gift,
  Medal,
  Share2,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react';

const companies = ['Pike', 'Linetec', 'PAR', 'MYR', 'Quanta', 'AEP', 'OG&E', 'PSO', 'Duke Energy', 'Entergy', 'Other'];

const scoreBreakdown = [
  { label: 'Budget', value: 92 },
  { label: 'Savings', value: 85 },
  { label: 'Debt', value: 81 },
  { label: 'Credit', value: 94 },
  { label: 'Investments', value: 83 },
  { label: 'Emergency Fund', value: 72 },
];

const achievements = [
  { label: 'First Scan', icon: Check, unlocked: true },
  { label: 'Debt Destroyer', icon: TrendingUp, unlocked: true },
  { label: 'Saved $10K', icon: Trophy, unlocked: true },
  { label: '100-Day Investor', icon: Medal, unlocked: false },
  { label: 'Emergency Fund', icon: ShieldCheck, unlocked: false },
  { label: 'Referral Champion', icon: Users, unlocked: false },
];

const initialGoals = [
  { id: 1, label: 'Save $500 this month', progress: 76, complete: false },
  { id: 2, label: 'Keep utilization under 10%', progress: 100, complete: true },
  { id: 3, label: 'Invest $250', progress: 64, complete: false },
  { id: 4, label: 'Build one month of expenses', progress: 48, complete: false },
];

export default function GrowthHub() {
  const [company, setCompany] = useState(() => localStorage.getItem('bcai-company') || 'Pike');
  const [copied, setCopied] = useState(false);
  const [goals, setGoals] = useState(initialGoals);

  const referralCode = useMemo(() => {
    const prefix = company === 'Other' ? 'CREW' : company.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return `${prefix}-4829`;
  }, [company]);

  const referralLink = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/welcome?ref=${referralCode}`;

  const saveCompany = (value: string) => {
    setCompany(value);
    localStorage.setItem('bcai-company', value);
  };

  const copyReferral = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      const input = document.createElement('textarea');
      input.value = referralLink;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  const shareReferral = async () => {
    if (navigator.share) {
      await navigator.share({
        title: 'Blue Collar AI',
        text: 'Use my referral link to build your full financial command center.',
        url: referralLink,
      });
      return;
    }
    await copyReferral();
  };

  const toggleGoal = (id: number) => {
    setGoals((current) => current.map((goal) => goal.id === id
      ? { ...goal, complete: !goal.complete, progress: goal.complete ? Math.min(goal.progress, 99) : 100 }
      : goal));
  };

  return (
    <div className="min-h-full bg-[#07111f] px-4 py-6 text-white md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-3xl border border-cyan-400/15 bg-gradient-to-br from-blue-500/15 via-[#0b1728] to-cyan-500/5 p-6 shadow-2xl shadow-blue-950/30 md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-cyan-300">
                <Sparkles className="h-3.5 w-3.5" /> Growth Hub
              </div>
              <h1 className="text-3xl font-black tracking-tight md:text-5xl">Turn progress into momentum.</h1>
              <p className="mt-3 text-sm leading-6 text-slate-300 md:text-base">
                Track your financial score, hit monthly goals, earn milestones, and bring your crew into Blue Collar AI with one link.
              </p>
            </div>
            <div className="grid min-w-full grid-cols-3 gap-3 lg:min-w-[420px]">
              {[
                ['18', 'Invited'],
                ['12', 'Signed Up'],
                ['9', 'Subscribed'],
              ].map(([value, label]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4 text-center backdrop-blur">
                  <div className="text-2xl font-black text-cyan-300 md:text-3xl">{value}</div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-blue-400/15 bg-[#0b1728] p-5 md:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-lg font-black"><Users className="h-5 w-5 text-cyan-400" /> Crew Referrals</div>
                <p className="mt-1 text-sm text-slate-400">Share this once. Every signup stays tied to your code.</p>
              </div>
              <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/10 px-3 py-2 text-right">
                <div className="text-xs text-emerald-300">Pending rewards</div>
                <div className="text-xl font-black text-emerald-300">$110</div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto]">
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-slate-500">Company / crew</label>
                <select
                  value={company}
                  onChange={(event) => saveCompany(event.target.value)}
                  className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#07111f] px-4 font-semibold text-white outline-none focus:border-cyan-400/40"
                >
                  {companies.map((name) => <option key={name}>{name}</option>)}
                </select>
              </div>
              <div className="rounded-2xl border border-blue-400/15 bg-blue-500/10 px-5 py-3 text-center md:min-w-44">
                <div className="text-[10px] font-black uppercase tracking-widest text-blue-300">Your code</div>
                <div className="mt-1 text-xl font-black tracking-wider text-white">{referralCode}</div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="truncate text-sm text-slate-300">{referralLink}</div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button onClick={copyReferral} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 font-bold text-cyan-300 transition hover:bg-cyan-400/15">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <button onClick={shareReferral} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 font-bold text-white transition hover:bg-blue-500">
                  <Share2 className="h-4 w-4" /> Share with crew
                </button>
              </div>
            </div>

            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-400/15 bg-amber-400/5 p-4 text-sm text-amber-100/80">
              <Gift className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
              Reward amounts are shown as beta placeholders until payment and subscription tracking are connected.
            </div>
          </section>

          <section className="rounded-3xl border border-blue-400/15 bg-[#0b1728] p-5 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-lg font-black"><Award className="h-5 w-5 text-cyan-400" /> Financial Health</div>
                <p className="mt-1 text-sm text-slate-400">Updates as account data improves.</p>
              </div>
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-cyan-400/30 bg-cyan-400/10">
                <div className="text-center"><div className="text-2xl font-black text-cyan-300">87</div><div className="text-[9px] font-bold text-slate-500">/ 100</div></div>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {scoreBreakdown.map((item) => (
                <div key={item.label}>
                  <div className="mb-1 flex justify-between text-xs font-semibold"><span className="text-slate-400">{item.label}</span><span>{item.value}</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" style={{ width: `${item.value}%` }} /></div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-3xl border border-blue-400/15 bg-[#0b1728] p-5 md:p-6">
            <div className="flex items-center gap-2 text-lg font-black"><Target className="h-5 w-5 text-cyan-400" /> Monthly Goals</div>
            <div className="mt-5 space-y-3">
              {goals.map((goal) => (
                <button key={goal.id} onClick={() => toggleGoal(goal.id)} className="w-full rounded-2xl border border-white/10 bg-black/15 p-4 text-left transition hover:border-cyan-400/20">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${goal.complete ? 'border-emerald-400/30 bg-emerald-400/15 text-emerald-300' : 'border-white/15 text-transparent'}`}><Check className="h-4 w-4" /></div>
                    <div className="flex-1">
                      <div className={`text-sm font-bold ${goal.complete ? 'text-slate-400 line-through' : 'text-white'}`}>{goal.label}</div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${goal.progress}%` }} /></div>
                    </div>
                    <div className="text-xs font-black text-slate-400">{goal.progress}%</div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-blue-400/15 bg-[#0b1728] p-5 md:p-6">
            <div className="flex items-center gap-2 text-lg font-black"><Trophy className="h-5 w-5 text-cyan-400" /> Achievements</div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {achievements.map((achievement) => {
                const Icon = achievement.icon;
                return (
                  <div key={achievement.label} className={`rounded-2xl border p-4 text-center ${achievement.unlocked ? 'border-amber-400/20 bg-amber-400/10' : 'border-white/8 bg-black/15 opacity-45'}`}>
                    <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-xl ${achievement.unlocked ? 'bg-amber-400/15 text-amber-300' : 'bg-white/5 text-slate-500'}`}><Icon className="h-5 w-5" /></div>
                    <div className="mt-2 text-xs font-black">{achievement.label}</div>
                    <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">{achievement.unlocked ? 'Unlocked' : 'Locked'}</div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <section className="rounded-3xl border border-emerald-400/15 bg-emerald-400/5 p-5 md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Monthly insight</div>
              <div className="mt-2 text-xl font-black">You spent $740 less than last month.</div>
              <p className="mt-1 text-sm text-slate-300">At this pace, your emergency fund target moves up by roughly three months.</p>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-400/15 bg-emerald-400/10 px-4 py-3 text-sm font-black text-emerald-300">
              <Building2 className="h-5 w-5" /> {company} benchmark ready
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
