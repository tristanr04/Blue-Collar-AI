/**
 * Rate limiters for all API routes.
 *
 * All limiters:
 *  - Return HTTP 429 with a structured JSON body on excess.
 *  - Set Retry-After header (seconds until window resets).
 *  - Set standard RateLimit-* headers (draft-7).
 *  - Log blocked requests via pino with { ip, route, event }.
 */

import rateLimit, { type Options, type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";

// ─── Shared handler factory ───────────────────────────────────────────────────

function makeHandler(routeLabel: string) {
  return (req: Request, res: Response, _next: NextFunction, _opts: Options): void => {
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    const info = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit;

    // Compute Retry-After (seconds until the window resets).
    let retryAfter = 60; // safe fallback
    if (info?.resetTime instanceof Date) {
      retryAfter = Math.max(0, Math.ceil((info.resetTime.getTime() - Date.now()) / 1000));
    }

    res.setHeader("Retry-After", retryAfter);

    logger.warn(
      { ip, route: routeLabel, retryAfter, event: "rate_limit_exceeded" },
      `Rate limit exceeded: ${routeLabel}`,
    );

    res.status(429).json({
      stage: "rate_limit",
      error: "Too many requests. Please wait before trying again.",
      retryAfter,
    });
  };
}

// ─── Limiter factory (exported for tests to create custom instances) ──────────

export interface LimiterOptions {
  windowMs: number;
  limit: number;
  label: string;
}

export function createLimiter(opts: LimiterOptions): RateLimitRequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: makeHandler(opts.label),
  });
}

// ─── Production limiters ──────────────────────────────────────────────────────

/** General API: 100 requests per 15 minutes per IP. */
export const generalLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  label: "general_api",
});

/** AI chat: 20 requests per hour per IP. */
export const aiAskLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  label: "ai_ask",
});

/** Document scanner: 10 documents per hour per IP. */
export const scanLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  label: "scan_document",
});
