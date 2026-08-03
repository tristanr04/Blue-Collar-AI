import React, { useEffect } from 'react';
import { useAuth } from '@clerk/react';
import { useLocation } from 'wouter';
import { Loader2 } from 'lucide-react';

export function ProtectedPage({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      setLocation('/sign-in');
    }
  }, [isLoaded, isSignedIn, setLocation]);

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Checking your session…</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function DeveloperOnlyPage({ children }: { children: React.ReactNode }) {
  const enabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_LAB === 'true';

  if (!enabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6 text-center">
        <div>
          <h1 className="text-xl font-semibold">Developer tool disabled</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The Test Lab is unavailable in this environment.
          </p>
        </div>
      </div>
    );
  }

  return <ProtectedPage>{children}</ProtectedPage>;
}
