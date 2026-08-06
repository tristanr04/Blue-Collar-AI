/**
 * Lightweight per-user in-memory response cache.
 *
 * Used by read-heavy endpoints (command-center, health-score) to avoid
 * hitting the database on every page refresh. TTLs are short (≤60 s) so
 * stale data never shows for more than a minute after a financial update.
 *
 * Cache entries are keyed by `${namespace}:${userId}`.
 * The cache is cleared automatically when its entry count exceeds a soft cap
 * (prevents unbounded growth in multi-tenant deployments).
 */

const DEFAULT_TTL_MS = 30_000;
const SOFT_CAP = 2_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class RouteCache<T> {
  private readonly map = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;
  private readonly namespace: string;

  constructor(namespace: string, ttlMs = DEFAULT_TTL_MS) {
    this.namespace = namespace;
    this.ttlMs = ttlMs;
  }

  private key(userId: string): string {
    return `${this.namespace}:${userId}`;
  }

  get(userId: string): T | undefined {
    const entry = this.map.get(this.key(userId));
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(this.key(userId));
      return undefined;
    }
    return entry.value;
  }

  set(userId: string, value: T): void {
    // Evict oldest entries if we're at the soft cap
    if (this.map.size >= SOFT_CAP) {
      const oldest = this.map.keys().next().value;
      if (oldest) this.map.delete(oldest);
    }
    this.map.set(this.key(userId), {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /** Invalidate a single user's entry (call after any mutation). */
  invalidate(userId: string): void {
    this.map.delete(this.key(userId));
  }

  /** Clear all entries (e.g. on server restart). */
  clear(): void {
    this.map.clear();
  }
}

/** 30-second cache for the command-center summary. */
export const commandCenterCache = new RouteCache<unknown>("cc", 30_000);

/** 60-second cache for the health-score detail response. */
export const healthScoreCache = new RouteCache<unknown>("hs", 60_000);
