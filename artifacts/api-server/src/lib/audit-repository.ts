import { and, desc, eq, lt } from "drizzle-orm";
import { auditEventsTable, db } from "@workspace/db";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "restore"
  | "import"
  | "migrate"
  | "scan"
  | "ai_request";

export interface AuditEventInput {
  userId: string;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  requestId?: string | null;
  source?: "api" | "migration" | "scanner" | "system";
  metadata?: Record<string, unknown>;
}

const FORBIDDEN_METADATA_KEYS = new Set([
  "authorization",
  "cookie",
  "token",
  "secret",
  "password",
  "file",
  "fileBuffer",
  "rawDocument",
  "requestBody",
]);

function sanitizeMetadata(input: Record<string, unknown> = {}): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) continue;
    if (value === undefined) continue;
    output[key] = value;
  }

  return output;
}

/** Append an immutable, user-scoped audit event. */
export async function appendAuditEvent(input: AuditEventInput) {
  const [event] = await db
    .insert(auditEventsTable)
    .values({
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      requestId: input.requestId ?? null,
      source: input.source ?? "api",
      metadata: sanitizeMetadata(input.metadata),
    })
    .returning();

  return event;
}

/**
 * Cursor-based audit history. The authenticated user ID is mandatory and is
 * always included in the query predicate to prevent cross-account reads.
 */
export async function listAuditEvents(
  userId: string,
  options: { limit?: number; before?: Date; entityType?: string } = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const predicates = [eq(auditEventsTable.userId, userId)];

  if (options.before) predicates.push(lt(auditEventsTable.createdAt, options.before));
  if (options.entityType) predicates.push(eq(auditEventsTable.entityType, options.entityType));

  return db
    .select()
    .from(auditEventsTable)
    .where(and(...predicates))
    .orderBy(desc(auditEventsTable.createdAt))
    .limit(limit);
}
