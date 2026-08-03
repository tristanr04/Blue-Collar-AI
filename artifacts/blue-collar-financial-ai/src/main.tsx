import { ClerkProvider } from '@clerk/react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function MissingAuthConfiguration() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="max-w-lg rounded-2xl border border-amber-500/30 bg-slate-900 p-6">
        <h1 className="text-xl font-semibold">Authentication setup required</h1>
        <p className="mt-3 text-sm text-slate-300">
          Add VITE_CLERK_PUBLISHABLE_KEY to Replit Secrets, then restart the app.
          The app fails closed instead of exposing financial features without authentication.
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  publishableKey ? (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/onboarding"
      afterSignOutUrl="/welcome"
    >
      <App />
    </ClerkProvider>
  ) : (
    <MissingAuthConfiguration />
  ),
);
