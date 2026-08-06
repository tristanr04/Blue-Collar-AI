import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@clerk/react';
import { Check, X, Zap, Star, Building2, AlertTriangle, Loader2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getPlans, createCheckoutSession, createBillingPortalSession, getMySubscription } from '@/lib/api';
import type { PlanDefinition } from '@/lib/api';

interface PlanDisplay extends PlanDefinition {
  marketing: {
    tagline: string;
    cta: string;
    features: string[];
    notIncluded?: string[];
  };
  stripeAvailable: boolean;
}

const PLAN_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  free: Zap,
  pro: Star,
  business: Building2,
};

export default function Pricing() {
  const { getToken } = useAuth();
  const [, setLocation] = useLocation();
  const [plans, setPlans] = useState<PlanDisplay[]>([]);
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [hasStripeSubscription, setHasStripeSubscription] = useState(false);
  const [stripeAvailable, setStripeAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // URL state messages
  const searchParams = new URLSearchParams(window.location.search);
  const billingState = searchParams.get('billing');

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken();
        if (!token) return;
        const [plansData, subData] = await Promise.all([
          getPlans(token),
          getMySubscription(token).catch(() => null),
        ]);
        setPlans(plansData.plans as PlanDisplay[]);
        setStripeAvailable(plansData.plans[0]?.stripeAvailable ?? false);
        if (subData) {
          setCurrentPlan(subData.effectivePlan);
          setHasStripeSubscription(subData.hasStripeSubscription ?? false);
        }
      } catch {
        setError('Unable to load pricing. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [getToken]);

  async function handleUpgrade(plan: 'pro' | 'business') {
    setCheckoutLoading(plan);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const { url } = await createCheckoutSession(token, plan);
      if (url) window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed. Please try again.');
    } finally {
      setCheckoutLoading(null);
    }
  }

  async function handleManageBilling() {
    setPortalLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const { url } = await createBillingPortalSession(token);
      if (url) window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open billing portal.');
    } finally {
      setPortalLoading(false);
    }
  }

  const proPlan = plans.find(p => p.id === 'pro');
  const proMonthly = proPlan ? (proPlan.monthlyPriceCents / 100).toFixed(2) : '14.99';
  const businessPlan = plans.find(p => p.id === 'business');
  const businessMonthly = businessPlan ? (businessPlan.monthlyPriceCents / 100).toFixed(2) : '49.99';

  return (
    <div className="min-h-screen bg-[#050b15] pb-24 pt-8">
      <div className="mx-auto max-w-5xl px-4">

        {/* Header */}
        <div className="mb-12 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Simple, transparent pricing
          </div>
          <h1 className="mb-4 text-3xl font-black text-white md:text-4xl">
            Built for the way you<br className="hidden md:block" /> actually get paid
          </h1>
          <p className="mx-auto max-w-xl text-slate-400">
            No surprise fees. Cancel anytime. Your data stays yours on every plan.
          </p>
        </div>

        {/* Billing state banners */}
        {billingState === 'success' && (
          <div className="mb-8 flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-emerald-300">
            <Check className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Subscription activated!</p>
              <p className="text-sm text-emerald-400/80">Your plan is now active. It may take a moment to reflect here.</p>
            </div>
          </div>
        )}
        {billingState === 'canceled' && (
          <div className="mb-8 flex items-center gap-3 rounded-2xl border border-slate-500/30 bg-slate-500/10 px-5 py-4 text-slate-300">
            <AlertTriangle className="h-5 w-5 shrink-0 text-slate-400" />
            <div>
              <p className="font-semibold">Checkout canceled</p>
              <p className="text-sm text-slate-400">No charge was made. You can start a new subscription any time.</p>
            </div>
          </div>
        )}

        {/* Stripe unavailable notice */}
        {!loading && !stripeAvailable && (
          <div className="mb-8 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-amber-300">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Checkout temporarily unavailable</p>
              <p className="mt-1 text-sm text-amber-400/80">
                Stripe is not yet configured. The pricing below is accurate — check back soon to subscribe.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-red-300">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
          </div>
        ) : (
          <>
            {/* Plan cards */}
            <div className="grid gap-6 md:grid-cols-3">
              {plans.map((plan) => {
                const Icon = PLAN_ICONS[plan.id] ?? Zap;
                const isPro = plan.id === 'pro';
                const isCurrent = currentPlan === plan.id;
                const price = plan.id === 'free' ? 0 : plan.id === 'pro' ? parseFloat(proMonthly) : parseFloat(businessMonthly);

                return (
                  <div
                    key={plan.id}
                    className={cn(
                      'relative flex flex-col rounded-3xl border p-6 transition-all',
                      isPro
                        ? 'border-emerald-500/50 bg-gradient-to-b from-emerald-500/10 to-transparent shadow-[0_0_40px_rgba(16,185,129,0.12)]'
                        : 'border-white/10 bg-white/[0.03]',
                    )}
                  >
                    {isPro && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                        <div className="rounded-full border border-emerald-500/50 bg-emerald-500 px-4 py-1 text-xs font-bold uppercase tracking-widest text-white shadow-lg">
                          Recommended
                        </div>
                      </div>
                    )}

                    <div className="mb-4 flex items-center gap-3">
                      <div className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-2xl',
                        isPro ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-slate-400',
                      )}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="font-bold text-white">{plan.name}</div>
                        <div className="text-xs text-slate-500">{plan.marketing.tagline}</div>
                      </div>
                    </div>

                    <div className="mb-6">
                      {price === 0 ? (
                        <span className="text-3xl font-black text-white">Free</span>
                      ) : (
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-black text-white">${price.toFixed(2)}</span>
                          <span className="text-sm text-slate-500">/month</span>
                        </div>
                      )}
                    </div>

                    {/* CTA */}
                    {isCurrent ? (
                      <div className={cn(
                        'mb-6 rounded-2xl border py-3 text-center text-sm font-semibold',
                        isPro ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-white/10 text-slate-400',
                      )}>
                        {plan.id === 'free' ? 'Current plan' : '✓ Active plan'}
                      </div>
                    ) : plan.id === 'free' ? (
                      <Button
                        variant="outline"
                        className="mb-6 w-full border-white/15 bg-transparent text-slate-300 hover:bg-white/10"
                        onClick={() => setLocation('/dashboard')}
                      >
                        Go to dashboard
                      </Button>
                    ) : (
                      <Button
                        className={cn(
                          'mb-6 w-full font-bold',
                          isPro
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                            : 'bg-slate-700 hover:bg-slate-600 text-white',
                        )}
                        disabled={!stripeAvailable || checkoutLoading === plan.id}
                        onClick={() => handleUpgrade(plan.id as 'pro' | 'business')}
                      >
                        {checkoutLoading === plan.id ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Starting…</>
                        ) : (
                          plan.marketing.cta
                        )}
                      </Button>
                    )}

                    {/* Features */}
                    <ul className="flex-1 space-y-2.5 text-sm">
                      {plan.marketing.features.map((f) => (
                        <li key={f} className="flex items-start gap-2.5">
                          <Check className={cn('mt-0.5 h-4 w-4 shrink-0', isPro ? 'text-emerald-400' : 'text-slate-400')} />
                          <span className="text-slate-300">{f}</span>
                        </li>
                      ))}
                      {plan.marketing.notIncluded?.map((f) => (
                        <li key={f} className="flex items-start gap-2.5 opacity-40">
                          <X className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                          <span className="text-slate-500">{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>

            {/* Manage billing */}
            {hasStripeSubscription && (
              <div className="mt-8 flex justify-center">
                <Button
                  variant="outline"
                  className="border-white/15 text-slate-300 hover:bg-white/10"
                  onClick={handleManageBilling}
                  disabled={portalLoading}
                >
                  {portalLoading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Opening…</>
                  ) : (
                    <><ExternalLink className="mr-2 h-4 w-4" />Manage billing &amp; invoices</>
                  )}
                </Button>
              </div>
            )}

            {/* Comparison table (mobile-friendly) */}
            <div className="mt-16">
              <h2 className="mb-6 text-center text-xl font-bold text-white">What's included</h2>
              <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="p-4 text-left font-semibold text-slate-400">Feature</th>
                      <th className="p-4 text-center font-semibold text-slate-400">Free</th>
                      <th className="p-4 text-center font-semibold text-emerald-400">Pro</th>
                      <th className="p-4 text-center font-semibold text-slate-400">Business</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['Document scans / month', '10', '150', 'Unlimited'],
                      ['AI questions / month', '20', '300', 'Unlimited'],
                      ['Tax scenarios', '3', '50', 'Unlimited'],
                      ['Cloud documents', '10', '500', '5,000'],
                      ['Financial health score', '—', '✓', '✓'],
                      ['Weekly snapshots', '—', '✓', '✓'],
                      ['Financial timeline', '—', '✓', '✓'],
                      ['Priority processing', '—', '✓', '✓'],
                      ['Team / crew seats', '—', '—', '✓'],
                      ['Admin analytics', '—', '—', '✓'],
                    ].map(([label, free, pro, biz]) => (
                      <tr key={label} className="border-b border-white/5 last:border-0">
                        <td className="p-4 text-slate-300">{label}</td>
                        <td className="p-4 text-center text-slate-500">{free}</td>
                        <td className="p-4 text-center font-medium text-emerald-400">{pro}</td>
                        <td className="p-4 text-center text-slate-400">{biz}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer note */}
            <p className="mt-8 text-center text-xs text-slate-600">
              All plans are billed monthly. No long-term contracts. Cancel anytime through your billing portal.
              Prices shown are educational estimates — you control all your financial decisions.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
