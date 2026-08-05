import React, { useEffect, useRef } from 'react';
import { ClerkProvider, useClerk } from '@clerk/react';
import { dark } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import '@/scanner-command.css';

import { StoreProvider } from '@/lib/store';
import MigrationDialog from '@/components/MigrationDialog';
import { JobQueueProvider } from '@/lib/jobQueue';
import { Shell } from '@/components/layout/Shell';
import { DeveloperOnlyPage, ProtectedPage } from '@/components/auth/ProtectedPage';

import Welcome from '@/pages/Welcome';
import SignIn from '@/pages/SignIn';
import SignUp from '@/pages/SignUp';
import Onboarding from '@/pages/Onboarding';
import Scanner from '@/pages/Scanner';
import Dashboard from '@/pages/Dashboard';
import Documents from '@/pages/Documents';
import DocumentsReview from '@/pages/DocumentsReview';
import Paystubs from '@/pages/Paystubs';
import Debts from '@/pages/Debts';
import Bills from '@/pages/Bills';
import Banking from '@/pages/Banking';
import Investments from '@/pages/Investments';
import Scenario from '@/pages/Scenario';
import AgeProgress from '@/pages/AgeProgress';
import GrowthHub from '@/pages/GrowthHub';
import TaxEstimator from '@/pages/TaxEstimator';
import Settings from '@/pages/Settings';
import AskAI from '@/pages/AskAI';
import TestLab from '@/pages/TestLab';
import NotFound from '@/pages/not-found';

// ─── Clerk key + proxy ────────────────────────────────────────────────────────
const clerkPubKey: string | undefined = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// proxyUrl is empty in dev (Clerk hits FAPI directly) and auto-set in prod.
// Do NOT gate on import.meta.env.PROD — the empty dev value is intentional.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

// Clerk passes full paths to routerPush/routerReplace; wouter's setLocation
// prepends the base, so strip it first to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

// ─── Clerk appearance — dark navy + emerald theme ────────────────────────────
const clerkAppearance = {
  baseTheme: dark,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#059669',       // emerald-600
    colorForeground: '#f8fafc',    // slate-50
    colorMutedForeground: '#94a3b8', // slate-400
    colorDanger: '#ef4444',        // red-500
    colorBackground: '#0f172a',    // slate-900
    colorNeutral: '#334155',       // slate-700
    colorInput: '#1e293b',         // slate-800
    colorInputForeground: '#f1f5f9', // slate-100
    fontFamily: 'Inter, system-ui, sans-serif',
    borderRadius: '0.5rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-slate-900 rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl shadow-black/40',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-white',
    headerSubtitle: 'text-slate-400',
    socialButtonsBlockButtonText: 'text-slate-200',
    formFieldLabel: 'text-slate-300',
    footerActionLink: 'text-emerald-400 hover:text-emerald-300',
    footerActionText: 'text-slate-400',
    dividerText: 'text-slate-500',
    identityPreviewEditButton: 'text-emerald-400',
    formFieldSuccessText: 'text-emerald-400',
    alertText: 'text-slate-200',
    logoBox: 'mb-1',
    logoImage: 'w-10 h-10',
    socialButtonsBlockButton: 'border-slate-700 hover:bg-slate-800 text-slate-200',
    formButtonPrimary: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    formFieldInput: 'bg-slate-800 border-slate-700 text-slate-100',
    footerAction: 'bg-slate-900/80',
    dividerLine: 'bg-slate-700',
    alert: 'bg-slate-800 border-slate-700',
    otpCodeFieldInput: 'bg-slate-800 border-slate-700 text-white',
    formFieldRow: '',
    main: '',
  },
};

const queryClient = new QueryClient();

// ─── Cache invalidation on user change ───────────────────────────────────────
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

// ─── Route wrappers ───────────────────────────────────────────────────────────
const protectedPage = (Page: React.ComponentType) =>
  function ProtectedRoute() {
    return <ProtectedPage><Page /></ProtectedPage>;
  };

const developerPage = (Page: React.ComponentType) =>
  function DeveloperRoute() {
    return <DeveloperOnlyPage><Page /></DeveloperOnlyPage>;
  };

// ─── Router ───────────────────────────────────────────────────────────────────
function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Welcome} />
        <Route path="/welcome" component={Welcome} />
        {/* REQUIRED: /*? optional wildcard matches both bare URL and Clerk OAuth sub-paths */}
        <Route path="/sign-in/*?" component={SignIn} />
        <Route path="/sign-up/*?" component={SignUp} />
        <Route path="/onboarding" component={protectedPage(Onboarding)} />
        <Route path="/scanner" component={protectedPage(Scanner)} />
        <Route path="/dashboard" component={protectedPage(Dashboard)} />
        <Route path="/documents/review" component={protectedPage(DocumentsReview)} />
        <Route path="/documents" component={protectedPage(Documents)} />
        <Route path="/paystubs" component={protectedPage(Paystubs)} />
        <Route path="/debts" component={protectedPage(Debts)} />
        <Route path="/bills" component={protectedPage(Bills)} />
        <Route path="/banking" component={protectedPage(Banking)} />
        <Route path="/investments" component={protectedPage(Investments)} />
        <Route path="/scenario" component={protectedPage(Scenario)} />
        <Route path="/age-progress" component={protectedPage(AgeProgress)} />
        <Route path="/growth" component={protectedPage(GrowthHub)} />
        <Route path="/tax-estimator" component={protectedPage(TaxEstimator)} />
        <Route path="/settings" component={protectedPage(Settings)} />
        <Route path="/ask-ai" component={protectedPage(AskAI)} />
        <Route path="/test-lab" component={developerPage(TestLab)} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

// ─── ClerkProvider — must live inside WouterRouter to use useLocation ─────────
function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  // Force dark mode for the command-center visual system (from origin/main)
  useEffect(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  }, []);

  return (
    <ClerkProvider
      publishableKey={clerkPubKey!}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      signInFallbackRedirectUrl={`${basePath}/dashboard`}
      signUpFallbackRedirectUrl={`${basePath}/onboarding`}
      afterSignOutUrl={`${basePath}/welcome`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <StoreProvider>
            <JobQueueProvider>
              <Router />
              <Toaster />
              <MigrationDialog />
            </JobQueueProvider>
          </StoreProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

// ─── Missing key fallback ─────────────────────────────────────────────────────
function MissingAuthConfig() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="max-w-lg rounded-2xl border border-amber-500/30 bg-slate-900 p-6">
        <h1 className="text-xl font-semibold">Authentication setup required</h1>
        <p className="mt-3 text-sm text-slate-300">
          VITE_CLERK_PUBLISHABLE_KEY is missing. Add it to Replit Secrets and
          restart the app.
        </p>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
function App() {
  if (!clerkPubKey) return <MissingAuthConfig />;

  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
