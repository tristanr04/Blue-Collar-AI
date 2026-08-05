/**
 * Shared Zod schemas for the Blue Collar Financial AI API.
 *
 * Import from "@workspace/api-zod" — these are the authoritative runtime
 * contracts for every request and response shape the API handles.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Allowed document types
// ─────────────────────────────────────────────────────────────────────────────

export const KNOWN_DOC_TYPES = [
  // Income
  "Paystub",
  // Banking
  "Checking Account",
  "Savings Account",
  "High-Yield Savings",
  "Money Market Account",
  "Certificate of Deposit",
  "Cash Management Account",
  "Bank Statement",
  // Credit / debt
  "Credit Card",
  "Credit Card Statement",
  "Line of Credit",
  "Auto Loan",
  "Personal Loan",
  "Mortgage",
  "HELOC",
  "Student Loan",
  // Investments / brokerage
  "Brokerage Account",
  "Margin Account",
  "Robo-Adviser Account",
  "Employee Stock Plan",
  // Retirement
  "401(k)",
  "Roth 401(k)",
  "403(b)",
  "457(b)",
  "Traditional IRA",
  "Roth IRA",
  "SEP IRA",
  "SIMPLE IRA",
  "Rollover IRA",
  "Pension",
  "Thrift Savings Plan",
  "HSA Investment Account",
  // Bills
  "Monthly Bill",
  "Utility Bill",
  // Meta
  "Multiple Documents",
  "Unknown",
] as const;

export type DocType = (typeof KNOWN_DOC_TYPES)[number];

/**
 * Accepts any string (the AI may invent types).
 * Known doc types pass through unchanged.
 * Anything not in the canonical list resolves to "Unknown" instead of erroring.
 */
export const DocTypeSchema = z
  .string({ invalid_type_error: "docType must be a string" })
  .max(100, { message: "docType string is too long" })
  .transform((val): DocType =>
    (KNOWN_DOC_TYPES as readonly string[]).includes(val)
      ? (val as DocType)
      : "Unknown",
  );

// ─────────────────────────────────────────────────────────────────────────────
// 2. Confidence values
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A confidence percentage in [0, 100].
 * Rejects NaN, ±Infinity, negative values, and values above 100.
 * Fractional values (e.g. 92.5) are accepted.
 */
export const ConfidenceSchema = z
  .number({
    invalid_type_error: "Confidence must be a number, not a string or boolean",
    required_error: "Confidence is required",
  })
  .finite({ message: "Confidence must be a finite number (NaN and Infinity are not allowed)" })
  .min(0, { message: "Confidence must be ≥ 0" })
  .max(100, { message: "Confidence must be ≤ 100" });

// ─────────────────────────────────────────────────────────────────────────────
// 3 & 4. Extracted financial fields
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The value portion of an extracted field.
 * Finite numbers (dollar amounts, rates, counts) or short strings (dates, labels).
 * null means the AI determined the field was not present in the document.
 */
const FieldValueSchema = z
  .union([
    z
      .number()
      .finite({ message: "Extracted numeric value must be finite (no NaN or Infinity)" }),
    z.string().max(500, { message: "Extracted string value must not exceed 500 characters" }),
  ])
  .nullable();

/**
 * A single field extracted from a financial document.
 */
export const ExtractedFieldSchema = z.object({
  value: FieldValueSchema,
  confidence: ConfidenceSchema,
  sourceText: z.string().max(500).optional(),
});

export type ExtractedField = z.infer<typeof ExtractedFieldSchema>;

/**
 * The complete fields map extracted from a document.
 * Keys are camelCase field names (max 100 chars). Max 200 total fields.
 */
export const ExtractedFieldsSchema = z
  .record(
    z.string().max(100, { message: "Field key must not exceed 100 characters" }),
    ExtractedFieldSchema,
  )
  .refine((fields) => Object.keys(fields).length <= 200, {
    message: "Too many extracted fields — AI output exceeded the 200-field limit",
  });

// ─────────────────────────────────────────────────────────────────────────────
// 5. Unknown fields
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A labeled field the AI noticed but that doesn't belong to the canonical
 * field list for the identified document type.
 */
export const UnknownFieldSchema = z.object({
  label: z.string().max(200, { message: "Unknown field label must not exceed 200 characters" }),
  value: FieldValueSchema,
  confidence: ConfidenceSchema,
});

export type UnknownField = z.infer<typeof UnknownFieldSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 6. Institution information
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Institution data returned by the scan endpoint after registry normalization.
 */
export const InstitutionSchema = z.object({
  rawName: z.string().max(200).nullable(),
  normalizedName: z.string().max(200).optional(),
  isKnownInstitution: z.boolean(),
});

export type Institution = z.infer<typeof InstitutionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 7. AI extraction output (raw model response)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The structured JSON the AI model is expected to return from a scan.
 *
 * Validation rules:
 * - Unknown docTypes coerce to "Unknown" rather than rejecting
 * - Missing optional fields receive safe defaults
 * - NaN / Infinity in any numeric position causes rejection
 * - Malformed objects (wrong types) cause rejection
 * - Extra top-level keys the AI adds are stripped
 */
export const AiExtractionOutputSchema = z.object({
  docType: DocTypeSchema,
  classificationConfidence: ConfidenceSchema.default(0),
  institution: z
    .object({
      rawName: z.string().max(200).nullable().default(null),
      isKnownInstitution: z.boolean().default(false),
    })
    .optional(),
  fields: ExtractedFieldsSchema.default({}),
  unknownFields: z.array(UnknownFieldSchema).max(50).default([]),
});

export type AiExtractionOutput = z.infer<typeof AiExtractionOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 8. POST /api/scan-document — full API response
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The complete response body sent back from POST /api/scan-document.
 * Includes AI extraction output plus server-side metadata.
 */
export const ScanDocumentResponseSchema = z.object({
  docType: DocTypeSchema,
  classificationConfidence: ConfidenceSchema.optional(),
  institution: InstitutionSchema,
  fields: ExtractedFieldsSchema,
  unknownFields: z.array(UnknownFieldSchema).optional(),
  fileName: z.string().max(500),
  mimeType: z.string().max(100),
});

export type ScanDocumentResponse = z.infer<typeof ScanDocumentResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/ask — request body
// ─────────────────────────────────────────────────────────────────────────────

const MAX_PROFILE_JSON_BYTES = 100_000; // 100 KB
const MAX_PROFILE_DEPTH = 10;

/**
 * Returns the maximum nesting depth of a JSON-compatible value.
 * Bails out early once the threshold is exceeded to avoid DoS via deep structures.
 */
function measureDepth(val: unknown, current = 0): number {
  // Hard stop well above the threshold so we never recurse deeply on attack input
  if (current > MAX_PROFILE_DEPTH + 5) return current;
  if (typeof val !== "object" || val === null) return current;
  const children = Array.isArray(val) ? val : Object.values(val as object);
  if (children.length === 0) return current;
  let max = current;
  for (const child of children) {
    const d = measureDepth(child, current + 1);
    if (d > max) max = d;
    if (max > MAX_PROFILE_DEPTH + 5) return max; // short-circuit
  }
  return max;
}

/**
 * The financialProfile payload in POST /api/ai/ask.
 *
 * Rules:
 * - Must be a plain JSON object (not an array or primitive)
 * - Serialized size ≤ 100 KB
 * - Nesting depth ≤ 10 levels
 */
export const FinancialProfileSchema = z
  .unknown()
  .refine(
    (val) => typeof val === "object" && val !== null && !Array.isArray(val),
    {
      message:
        "financialProfile must be a JSON object (not an array, string, or number)",
    },
  )
  .refine(
    (val) => {
      try {
        return JSON.stringify(val).length <= MAX_PROFILE_JSON_BYTES;
      } catch {
        return false;
      }
    },
    {
      message: `financialProfile exceeds the ${MAX_PROFILE_JSON_BYTES / 1000} KB size limit`,
    },
  )
  .refine((val) => measureDepth(val) <= MAX_PROFILE_DEPTH, {
    message: `financialProfile nesting depth exceeds the ${MAX_PROFILE_DEPTH}-level limit`,
  });

/**
 * Request body for POST /api/ai/ask.
 *
 * - question: 1–2 000 characters after trimming whitespace
 * - financialProfile: optional; validated for size + depth when present
 */
// ─────────────────────────────────────────────────────────────────────────────
// 4. Bulk migration (idempotent local→server import)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One record inside a migration payload.
 * clientId is the client-local UUID; all other fields are validated at the
 * repository level (insertPaystubSchema / insertDebtSchema / etc.).
 */
export const MigrateItemSchema = z
  .object({
    clientId: z
      .string({ required_error: "clientId is required" })
      .min(1, { message: "clientId must not be empty" }),
  })
  .passthrough(); // additional fields (employer, balance …) pass through to repo validation

/**
 * Request body for POST /api/migrate.
 *
 * - idempotencyKey: UUID v4 generated by the client and persisted in localStorage.
 *   Re-submitting the same key is safe — the server returns the original result.
 * - profile: optional; upserted server-side (not deduplicated by clientId).
 * - paystubs/debts/bills/assets: max 500 items each to bound transaction time.
 */
export const MigrateRequestSchema = z.object({
  idempotencyKey: z
    .string({ required_error: "idempotencyKey is required" })
    .uuid({ message: "idempotencyKey must be a UUID v4" })
    .max(64),
  profile: z.record(z.unknown()).optional(),
  paystubs: z.array(MigrateItemSchema).max(500).default([]),
  debts: z.array(MigrateItemSchema).max(500).default([]),
  bills: z.array(MigrateItemSchema).max(500).default([]),
  assets: z.array(MigrateItemSchema).max(500).default([]),
});

export type MigrateRequest = z.infer<typeof MigrateRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 5. AI ask
// ─────────────────────────────────────────────────────────────────────────────

export const AskRequestSchema = z.object({
  question: z
    .string({ required_error: "question is required" })
    .trim()
    .min(1, { message: "question must not be empty" })
    .max(2000, { message: "question must be 2,000 characters or fewer" }),
  financialProfile: FinancialProfileSchema.optional(),
});

export type AskRequest = z.infer<typeof AskRequestSchema>;
