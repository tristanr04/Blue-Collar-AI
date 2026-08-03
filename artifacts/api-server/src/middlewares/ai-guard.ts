/**
 * AI request guards:
 *
 * 1. aiKillSwitch    — checks AI_ENABLED env var; returns 503 when disabled.
 * 2. ConcurrencySemaphore — tracks in-flight requests; returns 429 when full.
 *
 * Singletons:
 *   scanSemaphore   — per-IP, max 3 simultaneous scans
 *   aiGlobalSemaphore — global, max AI_MAX_CONCURRENT_REQUESTS (default 10)
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";

// ─── AI Kill Switch ───────────────────────────────────────────────────────────

/**
 * Middleware that blocks all AI routes when AI_ENABLED=false (or "0").
 * Reads the env var on every request so the value can be changed at runtime
 * without a restart (e.g. via a process manager that hot-reloads env).
 */
export function aiKillSwitch(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const raw = (process.env.AI_ENABLED ?? "true").trim().toLowerCase();
  const disabled = raw === "false" || raw === "0";

  if (disabled) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    logger.warn(
      { ip, path: req.path, event: "ai_kill_switch" },
      "AI request blocked: AI_ENABLED is false",
    );
    res.status(503).json({
      stage: "ai_disabled",
      error: "AI features are temporarily unavailable.",
    });
    return;
  }

  next();
}

// ─── Per-IP Concurrency Semaphore ─────────────────────────────────────────────

export class PerIpConcurrencySemaphore {
  private readonly counts = new Map<string, number>();
  readonly maxPerIp: number;
  readonly label: string;

  constructor(maxPerIp: number, label: string) {
    this.maxPerIp = maxPerIp;
    this.label = label;
  }

  /** Current in-flight count for an IP (for testing/observability). */
  getCount(ip: string): number {
    return this.counts.get(ip) ?? 0;
  }

  /** Attempt to acquire a slot for `ip`. Returns false if at capacity. */
  acquire(ip: string): boolean {
    const current = this.counts.get(ip) ?? 0;
    if (current >= this.maxPerIp) return false;
    this.counts.set(ip, current + 1);
    return true;
  }

  /** Release a slot for `ip`. */
  release(ip: string): void {
    const current = this.counts.get(ip) ?? 0;
    const next = current - 1;
    if (next <= 0) {
      this.counts.delete(ip);
    } else {
      this.counts.set(ip, next);
    }
  }

  middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";

      if (!this.acquire(ip)) {
        logger.warn(
          {
            ip,
            path: req.path,
            active: this.getCount(ip),
            max: this.maxPerIp,
            label: this.label,
            event: "concurrency_exceeded",
          },
          `Per-IP concurrency limit exceeded: ${this.label}`,
        );
        res.status(429).json({
          stage: "concurrency_limit",
          error:
            "Too many simultaneous requests from your IP. Please wait for an active request to complete.",
        });
        return;
      }

      // Release on response finish OR close (client disconnect) — whichever fires first.
      let released = false;
      const doRelease = () => {
        if (!released) {
          released = true;
          this.release(ip);
        }
      };
      res.on("finish", doRelease);
      res.on("close", doRelease);

      next();
    };
  }
}

// ─── Global Concurrency Semaphore ─────────────────────────────────────────────

export class GlobalConcurrencySemaphore {
  private _active = 0;
  readonly max: number;
  readonly label: string;

  constructor(max: number, label: string) {
    this.max = max;
    this.label = label;
  }

  get active(): number {
    return this._active;
  }

  acquire(): boolean {
    if (this._active >= this.max) return false;
    this._active++;
    return true;
  }

  release(): void {
    if (this._active > 0) this._active--;
  }

  middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!this.acquire()) {
        const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
        logger.warn(
          {
            ip,
            path: req.path,
            active: this._active,
            max: this.max,
            label: this.label,
            event: "concurrency_exceeded",
          },
          `Global concurrency limit exceeded: ${this.label}`,
        );
        res.status(429).json({
          stage: "concurrency_limit",
          error:
            "Too many simultaneous AI requests. Please wait and try again.",
        });
        return;
      }

      let released = false;
      const doRelease = () => {
        if (!released) {
          released = true;
          this.release();
        }
      };
      res.on("finish", doRelease);
      res.on("close", doRelease);

      next();
    };
  }
}

// ─── Singletons ───────────────────────────────────────────────────────────────

/** Max 3 simultaneous scans per IP. */
export const scanSemaphore = new PerIpConcurrencySemaphore(3, "scan_document");

/** Global AI concurrency: AI_MAX_CONCURRENT_REQUESTS (default 10). */
const _rawMax = parseInt(process.env.AI_MAX_CONCURRENT_REQUESTS ?? "10", 10);
const _aiMax = Number.isFinite(_rawMax) && _rawMax > 0 ? _rawMax : 10;
export const aiGlobalSemaphore = new GlobalConcurrencySemaphore(
  _aiMax,
  "ai_ask",
);
