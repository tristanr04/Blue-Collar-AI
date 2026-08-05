/**
 * Production-safe CORS middleware.
 *
 * Development allows localhost, loopback, and Replit preview domains.
 * Production allows only exact origins or safe subdomain wildcards listed in
 * ALLOWED_ORIGINS, for example https://*.replit.dev.
 */

import cors, { type CorsOptions } from "cors";
import { logger } from "../lib/logger.js";

function wildcardOriginMatches(origin: string, pattern: string): boolean {
  const match = pattern.match(/^(https?):\/\/\*\.([a-z0-9.-]+)(?::(\d+))?$/i);
  if (!match) return false;

  try {
    const parsed = new URL(origin);
    const [, protocol, baseHost, port] = match;
    if (parsed.protocol !== `${protocol.toLowerCase()}:`) return false;
    if (port && parsed.port !== port) return false;

    const host = parsed.hostname.toLowerCase();
    const base = baseHost.toLowerCase();
    return host.endsWith(`.${base}`) && host !== base;
  } catch {
    return false;
  }
}

/** Returns true when the origin should be allowed. */
export function isOriginAllowed(
  origin: string,
  isDev: boolean,
  allowedOrigins: string[],
): boolean {
  if (isDev) {
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
    if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true;
    if (/^https:\/\/[^/]+\.replit\.dev$/.test(origin)) return true;
    if (/^https:\/\/[^/]+\.replit\.app$/.test(origin)) return true;
    if (/^https:\/\/[^/]+\.repl\.co$/.test(origin)) return true;
    return false;
  }

  return allowedOrigins.some(
    (allowed) => allowed === origin || wildcardOriginMatches(origin, allowed),
  );
}

export function buildCorsOptions(
  overrides?: { isDev?: boolean; allowedOrigins?: string[] },
): CorsOptions {
  const isDev = overrides?.isDev ?? process.env.NODE_ENV !== "production";

  const allowedOrigins =
    overrides?.allowedOrigins ??
    (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

  return {
    origin(origin, callback) {
      // Requests without an Origin header are server-to-server or same-origin.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (isOriginAllowed(origin, isDev, allowedOrigins)) {
        callback(null, true);
        return;
      }

      logger.warn(
        { origin, isDev, event: "cors_rejected" },
        "CORS: origin not allowed",
      );
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  };
}

export function makeCors(
  overrides?: { isDev?: boolean; allowedOrigins?: string[] },
) {
  return cors(buildCorsOptions(overrides));
}
