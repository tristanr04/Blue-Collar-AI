/**
 * jobQueue.tsx
 *
 * Background job queue for scanner imports and financial updates.
 * Persists to `bcf_jobs` in localStorage so jobs survive page navigation
 * and page refresh. An idempotency key (filename::size::lastModified) prevents
 * the same file from being queued twice.
 *
 * Usage:
 *   const { jobs, enqueue, updateJob, cancel, clearCompleted } = useJobQueue();
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type JobStatus =
  | 'Queued'
  | 'Processing'
  | 'Waiting for AI'
  | 'Validating'
  | 'Routing'
  | 'Completed'
  | 'Failed'
  | 'Cancelled';

export interface Job {
  id: string;
  idempotencyKey: string;
  filename: string;
  description: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  /** Arbitrary result payload — consumers cast to their own type */
  result?: unknown;
}

interface JobQueueContextType {
  jobs: Job[];
  /** Add a new job. Returns job id. No-ops silently if idempotencyKey already active. */
  enqueue: (opts: { idempotencyKey: string; filename: string; description: string }) => string | null;
  /** Update status / error / result of an existing job */
  updateJob: (id: string, updates: Partial<Pick<Job, 'status' | 'error' | 'result'>>) => void;
  /** Cancel a queued or processing job */
  cancel: (id: string) => void;
  /** Remove all completed/failed/cancelled jobs from the list */
  clearCompleted: () => void;
  /** True when at least one job is actively running */
  isActive: boolean;
  /** Count of jobs in non-terminal states */
  activeCount: number;
}

const STORAGE_KEY = 'bcf_jobs';

const JobQueueContext = createContext<JobQueueContextType | null>(null);

function loadPersistedJobs(): Job[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const jobs: Job[] = JSON.parse(raw);
    // On reload, any job that was "in flight" becomes Queued so it can retry
    return jobs.map(j =>
      j.status === 'Processing' || j.status === 'Waiting for AI' || j.status === 'Validating' || j.status === 'Routing'
        ? { ...j, status: 'Queued' as JobStatus, updatedAt: new Date().toISOString() }
        : j,
    );
  } catch {
    return [];
  }
}

export function JobQueueProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>(loadPersistedJobs);

  // Persist whenever jobs change
  useEffect(() => {
    try {
      // Only persist non-terminal jobs + last 50 completed
      const toStore = [
        ...jobs.filter(j => j.status === 'Queued' || j.status === 'Processing' || j.status === 'Waiting for AI' || j.status === 'Validating' || j.status === 'Routing'),
        ...jobs.filter(j => j.status === 'Completed' || j.status === 'Failed' || j.status === 'Cancelled').slice(-50),
      ];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch {
      /* localStorage full / unavailable */
    }
  }, [jobs]);

  const enqueue = useCallback(
    ({ idempotencyKey, filename, description }: { idempotencyKey: string; filename: string; description: string }): string | null => {
      // Prevent double-queuing the same file while it is still active
      let existingId: string | null = null;
      setJobs(prev => {
        const active = prev.find(
          j =>
            j.idempotencyKey === idempotencyKey &&
            j.status !== 'Completed' &&
            j.status !== 'Failed' &&
            j.status !== 'Cancelled',
        );
        if (active) {
          existingId = active.id;
          return prev;
        }
        const newJob: Job = {
          id: crypto.randomUUID(),
          idempotencyKey,
          filename,
          description,
          status: 'Queued',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        existingId = newJob.id;
        return [...prev, newJob];
      });
      return existingId;
    },
    [],
  );

  const updateJob = useCallback((id: string, updates: Partial<Pick<Job, 'status' | 'error' | 'result'>>) => {
    setJobs(prev =>
      prev.map(j =>
        j.id === id ? { ...j, ...updates, updatedAt: new Date().toISOString() } : j,
      ),
    );
  }, []);

  const cancel = useCallback((id: string) => {
    setJobs(prev =>
      prev.map(j =>
        j.id === id && j.status !== 'Completed' && j.status !== 'Failed'
          ? { ...j, status: 'Cancelled', updatedAt: new Date().toISOString() }
          : j,
      ),
    );
  }, []);

  const clearCompleted = useCallback(() => {
    setJobs(prev =>
      prev.filter(
        j => j.status !== 'Completed' && j.status !== 'Failed' && j.status !== 'Cancelled',
      ),
    );
  }, []);

  const activeCount = jobs.filter(
    j =>
      j.status === 'Queued' ||
      j.status === 'Processing' ||
      j.status === 'Waiting for AI' ||
      j.status === 'Validating' ||
      j.status === 'Routing',
  ).length;

  return (
    <JobQueueContext.Provider
      value={{ jobs, enqueue, updateJob, cancel, clearCompleted, isActive: activeCount > 0, activeCount }}
    >
      {children}
    </JobQueueContext.Provider>
  );
}

export function useJobQueue(): JobQueueContextType {
  const ctx = useContext(JobQueueContext);
  if (!ctx) throw new Error('useJobQueue must be used within JobQueueProvider');
  return ctx;
}
