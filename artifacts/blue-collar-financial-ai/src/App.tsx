import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';

import { StoreProvider } from '@/lib/store';
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
import Settings from '@/pages/Settings';
import AskAI from '@/pages/AskAI';
import TestLab from '@/pages/TestLab';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

const protectedPage = (Page: React.ComponentType) => function ProtectedRoute() {
  return <ProtectedPage><Page /></ProtectedPage>;
};

const developerPage = (Page: React.ComponentType) => function DeveloperRoute() {
  return <DeveloperOnlyPage><Page /></DeveloperOnlyPage>;
};

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Welcome} />
        <Route path="/welcome" component={Welcome} />
        <Route path="/sign-in" component={SignIn} />
        <Route path="/sign-up" component={SignUp} />
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
        <Route path="/settings" component={protectedPage(Settings)} />
        <Route path="/ask-ai" component={protectedPage(AskAI)} />
        <Route path="/test-lab" component={developerPage(TestLab)} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
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
