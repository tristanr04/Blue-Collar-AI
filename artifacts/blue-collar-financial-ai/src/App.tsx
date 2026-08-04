import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import '@/scanner-command.css';

import { StoreProvider } from '@/lib/store';
import { JobQueueProvider } from '@/lib/jobQueue';
import { Shell } from '@/components/layout/Shell';

import Welcome from '@/pages/Welcome';
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
import Settings from '@/pages/Settings';
import AskAI from '@/pages/AskAI';
import TestLab from '@/pages/TestLab';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Welcome} />
        <Route path="/welcome" component={Welcome} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/scanner" component={Scanner} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/documents/review" component={DocumentsReview} />
        <Route path="/documents" component={Documents} />
        <Route path="/paystubs" component={Paystubs} />
        <Route path="/debts" component={Debts} />
        <Route path="/bills" component={Bills} />
        <Route path="/banking" component={Banking} />
        <Route path="/investments" component={Investments} />
        <Route path="/scenario" component={Scenario} />
        <Route path="/settings" component={Settings} />
        <Route path="/ask-ai" component={AskAI} />
        <Route path="/test-lab" component={TestLab} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <StoreProvider>
          <JobQueueProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <Router />
            </WouterRouter>
            <Toaster />
          </JobQueueProvider>
        </StoreProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
