import type { NextFunction, Request, Response } from "express";

const SENSITIVE_API_PREFIXES = [
  "/api/financial",
  "/api/migrate",
  "/api/scan-document",
  "/api/ai",
  "/api/capabilities",
] as const;

/**
 * Prevent sensitive financial and AI responses from being stored by browsers,
 * CDNs, shared proxies, or intermediary caches.
 */
export function sensitiveResponseNoStore(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const path = req.originalUrl.split("?", 1)[0] ?? req.path;
  const isSensitive = SENSITIVE_API_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );

  if (isSensitive) {
    res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }

  next();
}
