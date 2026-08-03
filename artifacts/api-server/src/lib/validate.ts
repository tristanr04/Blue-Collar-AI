/**
 * Zod-based request validation middleware factory.
 *
 * Usage:
 *   router.post("/route", validateBody(MySchema), handler);
 *
 * On success  — req.body is replaced with the parsed (coerced + stripped) value.
 * On failure  — responds HTTP 400 with { stage, error, fieldErrors }.
 */

import { ZodError, type ZodSchema } from "zod";
import type { Request, Response, NextFunction } from "express";

// ─── Error response shape ─────────────────────────────────────────────────────

export interface ValidationErrorBody {
  stage: string;
  error: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Converts a ZodError into a flat { path → messages[] } map.
 * Top-level issues (no path) are keyed under "_root".
 */
export function formatZodFieldErrors(err: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_root";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

// ─── Middleware factory ───────────────────────────────────────────────────────

/**
 * Returns an Express middleware that validates req.body against `schema`.
 *
 * @param schema   Any Zod schema. Transformations and defaults are applied on
 *                 success and written back to req.body.
 * @param stage    The "stage" field in the 400 response. Defaults to
 *                 "request_validation".
 */
export function validateBody<T>(
  schema: ZodSchema<T>,
  stage = "request_validation",
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fieldErrors = formatZodFieldErrors(result.error);
      const body: ValidationErrorBody = {
        stage,
        error: "Request body is invalid.",
        fieldErrors,
      };
      res.status(400).json(body);
      return;
    }
    // Replace req.body with the parsed value so handlers get coerced types
    // (e.g. trimmed question string, default-filled objects).
    (req as Request & { body: T }).body = result.data;
    next();
  };
}

/**
 * Validates an arbitrary value (not a request body) against a schema
 * and returns a structured error body if validation fails.
 * Useful for validating AI output or other server-side data.
 */
export function validateValue<T>(
  schema: ZodSchema<T>,
  value: unknown,
  stage: string,
): { success: true; data: T } | { success: false; body: ValidationErrorBody } {
  const result = schema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    body: {
      stage,
      error: "Validation failed.",
      fieldErrors: formatZodFieldErrors(result.error),
    },
  };
}
