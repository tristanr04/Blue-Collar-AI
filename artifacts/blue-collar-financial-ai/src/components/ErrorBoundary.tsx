import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Global error boundary — catches render-phase errors in the component tree
 * and displays a recovery UI instead of crashing the entire app.
 *
 * Phase 7 requirement: prevent crashes from malformed data; recover automatically
 * when possible (user can reset without a full page reload).
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });
    // Log to console in dev — in prod, this would pipe to an error-tracking service.
    if (process.env.NODE_ENV !== 'production') {
      console.error('[ErrorBoundary]', error, errorInfo);
    }
  }

  private reset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          role="alert"
          aria-live="assertive"
          className="flex min-h-[300px] flex-col items-center justify-center gap-6 rounded-2xl border border-red-400/20 bg-red-400/5 p-8 text-center"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-red-400/20 bg-red-400/10">
            <AlertTriangle className="h-7 w-7 text-red-400" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white">Something went wrong</h2>
            <p className="mt-2 max-w-sm text-sm text-slate-400">
              {this.state.error?.message
                ? `Error: ${this.state.error.message}`
                : 'An unexpected error occurred. Your data is safe.'}
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={this.reset}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
            >
              Reload Page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/** Lightweight route-level boundary — shows a minimal retry strip. */
export function PageErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="flex min-h-screen items-center justify-center p-8">
          <div className="max-w-md text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-amber-400 mb-4" />
            <h1 className="text-xl font-black text-white mb-2">Page failed to load</h1>
            <p className="text-sm text-slate-400 mb-6">
              This might be a temporary issue. Try refreshing or navigating back.
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => window.location.reload()} className="bg-primary text-primary-foreground">
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
              <Button variant="outline" onClick={() => window.history.back()}>
                Go Back
              </Button>
            </div>
          </div>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
