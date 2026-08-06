import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import {
  Award,
  Building2,
  Check,
  Copy,
  Gift,
  Loader2,
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

interface ReferralDashboard {
  code: string;
  isActive: boolean;
  counts: {
    visits: number;
    signups: number;
    activated: number;
    paid: number;
    rewardsPaid: number;
  };
}

export default function GrowthHub() {
  const { getToken } = useAuth();
  const [company, setCompany] = useState(() => localStorage.getItem('bcai-company') || 'Pike');
  const [copied, setCopied] = useState(false);

  // Real referral data from API
  const [referralDash, setReferralDash] = useState<ReferralDashboard | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralLoading, setReferralLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;

        // Get or create referral code
        const codeRes = await fetch('/api/referrals/code', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (codeRes.ok) {
          const codeData = await codeRes.json();
          if (mounted) setReferralCode(codeData.code);
        }

        // Get dashboard stats
        const dashRes = await fetch('/api/referrals/dashboard', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (dashRes.ok) {
          const dashData = await dashRes.json();
          if (mounted) setReferralDash(dashData.dashboard);
        }
      } catch {
        // silently degrade — referral code falls back to local
      } finally {
        if (mounted) setReferralLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [getToken]);

  const displayCode = referralCode ?? (() => {
    const prefix = company === 'Other' ? 'CREW' : company.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return `${prefix}-4829`;
  })();

  const referralLink = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/welcome?ref=${displayCode}`;

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

  const toggleGoal = (id: number) => {};

  return (
    <div className="min-h-screen bg-[#060f1e] p-4 md:p-8 text-white">
      <div className="mx-auto max-w-4xl space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-cyan-400" />
              <h1 className="text-2xl font-black">Growth Hub</h1>
            </div>
            <p className="mt-1 text-sm text-slate-400">Track referrals, achievements, and financial milestones.</p>
          </div>
          <select
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white"
            value={company}
            onChange={(e) => saveCompany(e.target.value)}
          >
            {companies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Referral card */}
        <section className="rounded-3xl border border-blue-400/15 bg-[#0b1728] p-5 md:p-6">
          <div className="flex items-center gap-2 text-lg font-black">
            <Users className="h-5 w-5 text-cyan-400" /> Refer Your Crew
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Share your personal link. When a crew member signs up and activates, you both get rewarded.
          </p>

          {referralLoading ? (
            <div className="mt-4 flex items-center gap-2 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading your referral code…</span>
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-sm text-cyan-300 break-all">
                  {referralLink}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={copyReferral}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-bold transition hover:bg-white/10"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={shareReferral}
                    className="flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-cyan-400"
                  >
                    <Share2 className="h-4 w-4" /> Share
                  </button>
                </div>
              </div>

              {/* Real stats from API */}
              {referralDash && (
                <div className="mt-4 grid grid-cols-4 gap-3">
                  {[
                    { label: 'Visits', value: referralDash.counts.visits },
                    { label: 'Signups', value: referralDash.counts.signups },
                    { label: 'Activated', value: referralDash.counts.activated },
                    { label: 'Paid', value: referralDash.counts.paid },
                  ].map((s) => (
                    <div key={s.label} className="rounded-2xl border border-white/8 bg-black/15 p-3 text-center">
                      <div className="text-xl font-black text-cyan-300">{s.value}</div>
                      <div className="text-xs font-bold text-slate-500">{s.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-400/15 bg-amber-400/5 p-4 text-sm text-amber-100/80">
            <Gift className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            Reward amounts are shown as beta placeholders until payment and subscription tracking are connected.
          </div>
        </section>

        {/* Achievements */}
        <section className="rounded-3xl border border-blue-400/15 bg-[#0b1728] p-5 md:p-6">
          <div className="flex items-center gap-2 text-lg font-black">
            <Trophy className="h-5 w-5 text-cyan-400" /> Achievements
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {achievements.map((achievement) => {
              const Icon = achievement.icon;
              return (
                <div key={achievement.label} className={`rounded-2xl border p-4 text-center ${achievement.unlocked ? 'border-amber-400/20 bg-amber-400/10' : 'border-white/8 bg-black/15 opacity-45'}`}>
                  <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-xl ${achievement.unlocked ? 'bg-amber-400/15 text-amber-300' : 'bg-white/5 text-slate-500'}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="mt-2 text-xs font-black">{achievement.label}</div>
                  <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">
                    {achievement.unlocked ? 'Unlocked' : 'Locked'}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Financial Health */}
        <section className="rounded-3xl border border-blue-400/15 bg-[#0b1728] p-5 md:p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-lg font-black">
                <Award className="h-5 w-5 text-cyan-400" /> Financial Health
              </div>
              <p className="mt-1 text-sm text-slate-400">Updates as account data improves.</p>
            </div>
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-cyan-400/30 bg-cyan-400/10">
              <div className="text-center">
                <div className="text-2xl font-black text-cyan-300">87</div>
                <div className="text-[9px] font-bold text-slate-500">/ 100</div>
              </div>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {scoreBreakdown.map((item) => (
              <div key={item.label}>
                <div className="mb-1 flex justify-between text-xs font-semibold">
                  <span className="text-slate-400">{item.label}</span>
                  <span>{item.value}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/5">
                  <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" style={{ width: `${item.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-400/15 bg-emerald-400/5 p-5 md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Monthly insight</div>
              <div className="mt-2 text-xl font-black">You spent $740 less than last month.</div>
              <p className="mt-1 text-sm text-slate-300">
                At this pace, your emergency fund target moves up by roughly three months.
              </p>
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
