/**
 * Phase 8 — Loading animations
 * Provides consistent loading states across the app.
 */
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageSkeletonProps {
  className?: string;
}

/** Full-page skeleton used as the React.Suspense fallback for lazy-loaded pages. */
export function PageSkeleton({ className }: PageSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading page"
      aria-busy="true"
      className={cn('min-h-screen bg-[#060f1e] p-4 md:p-8', className)}
    >
      <div className="mx-auto max-w-4xl space-y-6 animate-pulse">
        {/* Header skeleton */}
        <div className="h-8 w-48 rounded-xl bg-white/5" />
        <div className="h-4 w-72 rounded-lg bg-white/5" />

        {/* Card skeletons */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl border border-white/5 bg-white/3" />
          ))}
        </div>

        <div className="h-64 rounded-3xl border border-white/5 bg-white/3" />
        <div className="h-48 rounded-3xl border border-white/5 bg-white/3" />
      </div>
    </div>
  );
}

/** Inline spinner for buttons and small loading states. */
export function InlineSpinner({
  size = 'sm',
  label = 'Loading',
}: {
  size?: 'xs' | 'sm' | 'md';
  label?: string;
}) {
  const cls = { xs: 'h-3 w-3', sm: 'h-4 w-4', md: 'h-5 w-5' }[size];
  return (
    <span role="status" aria-label={label} className="inline-flex items-center gap-2">
      <Loader2 className={cn(cls, 'animate-spin')} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Full-screen centered spinner for top-level auth loading. */
export function FullScreenSpinner({ message = 'Loading…' }: { message?: string }) {
  return (
    <div
      role="status"
      aria-label={message}
      className="flex min-h-screen items-center justify-center bg-[#060f1e]"
    >
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-cyan-400" />
        <p className="text-sm font-medium text-slate-400">{message}</p>
      </div>
    </div>
  );
}
