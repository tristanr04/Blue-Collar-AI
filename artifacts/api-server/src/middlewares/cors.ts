/**
 * Production-safe CORS middleware.
 *
 * Development  — allows localhost on any port, *.replit.dev, *.replit.app,
 *                and same-origin (no Origin header) requests.
 * Production   — allows only origins listed in the ALLOWED_ORIGINS env var
 *                (comma-separated).  Same-origin requests are always allowed.
 *
 * Never uses unrestricted cors() in production.
 */

import cors, { type CorsOptions } from "cors";
import { logger } from "../lib/logger.js";

// ─── Origin matcher ───────────────────────────────────────────────────────────

/** Returns true when the origin should be allowed. */
export function isOriginAllowed(
  origin: string,
  isDev: boolean,
  allowedOrigins: string[],
): boolean {
  if (isDev) {
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
    if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true;
    if (/\.replit\.dev$/.test(origin)) return true;
    if (/\.replit\.app$/.test(origin)) return true;
    return false;
  }
  return allowedOrigins.includes(origin);
}

// ─── Options factory ──────────────────────────────────────────────────────────

export function buildCorsOptions(
  overrides?: { isDev?: boolean; allowedOrigins?: string[] },
): CorsOptions {
  const isDev =
    overrides?.isDev ?? process.env.NODE_ENV !== "production";

  const allowedOrigins: string[] =
    overrides?.allowedOrigins ??
    (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  return {
    origin(origin, callback) {
      // Same-origin requests (curl, server-to-server, proxied) have no Origin header.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (isOriginAllowed(origin, isDev, allowedOrigins)) {
        callback(null, true);
      } else {
        logger.warn(
          { origin, isDev, event: "cors_rejected" },
          "CORS: origin not allowed",
        );
        // Return false — the cors library will omit Access-Control-Allow-Origin,
        // causing browsers to block the response.
        callback(null, false);
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  };
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function makeCors(
  overrides?: { isDev?: boolean; allowedOrigins?: string[] },
) {
  return cors(buildCorsOptions(overrides));
}
