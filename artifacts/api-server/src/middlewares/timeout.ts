/**
 * Request timeout middleware.
 *
 * Fires an HTTP 504 response if the handler does not respond within `ms`.
 * Also exports `makeAbortController` for route handlers that need to abort
 * an in-flight async operation (e.g. an OpenAI stream) when the client
 * disconnects or when the timeout expires.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";

// ─── Timeout middleware ───────────────────────────────────────────────────────

/**
 * Returns an Express middleware that sends HTTP 504 if the handler has not
 * called `res.end()` / `res.json()` / etc. within `ms` milliseconds.
 *
 * The timer is cancelled automatically when the response finishes or when
 * the client closes the connection.
 */
export function requestTimeout(ms: number, stage = "request_timeout") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";

    const timer = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn(
          { ip, path: req.path, timeoutMs: ms, event: "request_timeout" },
          `Request timed out after ${ms}ms`,
        );
        res.status(504).json({
          stage,
          error: "Request timed out. Please try again.",
        });
      }
    }, ms);

    let cleared = false;
    const clearTimer = () => {
      if (!cleared) {
        cleared = true;
        clearTimeout(timer);
      }
    };

    res.on("finish", clearTimer);
    res.on("close", clearTimer);

    next();
  };
}

// ─── Per-request AbortController helper ──────────────────────────────────────

export interface BoundAbortController {
  signal: AbortSignal;
  /** Abort immediately (e.g. on timeout). */
  abort: () => void;
  /** Call when the async work completes successfully to cancel the timeout. */
  clearTimeout: () => void;
}

/**
 * Creates an AbortController whose signal is automatically aborted after
 * `timeoutMs` and also when the HTTP response closes (client disconnect).
 *
 * Usage in a route handler:
 *
 *   const abort = makeAbortController(res, 60_000);
 *   try {
 *     const result = await someAsyncOp({ signal: abort.signal });
 *     abort.clearTimeout();
 *   } catch (err) {
 *     if (abort.signal.aborted) { ... handle timeout/disconnect ... }
 *   }
 */
export function makeAbortController(
  res: Response,
  timeoutMs: number,
): BoundAbortController {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let cleaned = false;
  const cleanup = () => {
    if (!cleaned) {
      cleaned = true;
      clearTimeout(timer);
    }
  };

  // Abort on client disconnect so the upstream request is also cancelled.
  res.on("close", () => {
    cleanup();
    controller.abort();
  });

  return {
    signal: controller.signal,
    abort: () => {
      cleanup();
      controller.abort();
    },
    clearTimeout: cleanup,
  };
}
