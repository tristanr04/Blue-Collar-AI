// API client — all calls go to the API server artifact at /api
// Replit path routing: artifact.toml maps paths=["/api"] to the API server on
// port 8080. The Vite dev server also proxies /api → 8080 (see vite.config.ts).
// Never use /api-server/... — that prefix is not a registered service path.
const API_BASE = "/api";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface ScanFieldValue {
  value: string | number | boolean | null;
  confidence: number;
  sourceText?: string;
}

export interface InstitutionInfo {
  rawName: string | null;
  normalizedName: string | null;
  institutionCategory: string | null;
  matchedAlias: string | null;
  confidence: number;
  isKnownInstitution: boolean;
}

export interface UnknownField {
  label: string;
  value: string | number | null;
  confidence: number | null;
}

/** Normalized vehicle-loan extraction returned when docType is Auto Loan. */
export interface VehicleLoanExtraction {
  documentType: "vehicleLoan";
  loanName: string | null;
  accountLast4: string | null;
  balanceOwed: number | null;
  originalAmount: number | null;
  apr: number | null;
  monthlyPayment: number | null;
  monthsRemaining: number | null;
  nextDueDate: string | null;
  confidence: Record<string, number>;
}

export interface ScanResult {
  docType: string;
  classificationConfidence: number;
  fields: Record<string, ScanFieldValue>;
  institution?: InstitutionInfo;
  unknownFields?: UnknownField[];
  fileName: string;
  mimeType: string;
  error?: string;
  /** Set when the server used the vehicle-loan fast path. */
  success?: boolean;
  type?: string;
  documentType?: string;
  data?: VehicleLoanExtraction | Record<string, unknown>;
  extraction?: VehicleLoanExtraction | Record<string, unknown>;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/** Build an Authorization header object — omits the header when token is absent. */
function authedHeaders(
  token?: string | null,
  extra?: Record<string, string>,
): HeadersInit {
  const h: Record<string, string> = { ...(extra ?? {}) };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

// ─── Scan ─────────────────────────────────────────────────────────────────────

/** Upload a single file and get AI extraction results. */
export async function scanFile(
  file: File,
  token?: string | null,
): Promise<ScanResult> {
  const form = new FormData();
  // Always pass filename explicitly so multer receives originalname correctly
  // even when the browser omits it (common on iOS Safari).
  form.append("file", file, file.name);

  let res: Response;
  try {
    // Do NOT set Content-Type manually — let fetch generate the multipart boundary.
    res = await fetch(`${API_BASE}/scan-document`, {
      method: "POST",
      body: form,
      headers: authedHeaders(token),
    });
  } catch (err) {
    throw new Error(
      JSON.stringify({
        stage: "upload_request",
        message:
          err instanceof Error
            ? err.message
            : "Network error — check your connection",
        filename: file.name,
      }),
    );
  }

  const json = await res.json().catch(() => ({
    stage: "unknown",
    message: `Upload failed with HTTP ${res.status}`,
  }));

  if (!res.ok) {
    throw new Error(
      JSON.stringify({
        stage: (json as any).stage ?? "backend_receipt",
        message:
          (json as any).error ??
          (json as any).message ??
          `Upload failed with HTTP ${res.status}`,
        filename: file.name,
      }),
    );
  }
  return json as ScanResult;
}

// ─── Capabilities ─────────────────────────────────────────────────────────────

/** Check whether the AI backend is available. */
export async function checkCapabilities(): Promise<{ ai: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/capabilities`);
    if (!res.ok) return { ai: false };
    return await res.json();
  } catch {
    return { ai: false };
  }
}

// ─── Ask AI (SSE stream) ──────────────────────────────────────────────────────

/**
 * Ask the AI financial assistant a question with the user's confirmed data.
 *
 * Improvements over the previous version:
 * - Reads non-OK HTTP responses before touching the stream.
 * - Surfaces streamed `{ error }` SSE messages as thrown errors.
 * - Accepts an AbortSignal for user cancellation.
 * - Stops cleanly at `[DONE]` without auto-retry.
 */
export async function askAI(
  question: string,
  onDelta: (text: string) => void,
  options?: { token?: string | null; signal?: AbortSignal },
): Promise<void> {
  const res = await fetch(`${API_BASE}/ai/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authedHeaders(options?.token),
    } as HeadersInit,
    // financialProfile is intentionally omitted — the server loads the
    // authenticated user's data directly from the database.
    body: JSON.stringify({ question }),
    signal: options?.signal,
  });

  if (!res.ok) {
    // Read the error body before it's consumed by stream logic.
    const json = await res.json().catch(() => ({}));
    throw new Error(
      (json as any).error ?? `AI request failed (${res.status})`,
    );
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response stream");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") return;
      let parsed: any;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue; // malformed SSE line — skip silently
      }
      // Surface stream-embedded errors immediately.
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.delta) onDelta(parsed.delta);
    }
  }
}

// ─── Migration (idempotent bulk import) ───────────────────────────────────────

export interface MigrationIdMap {
  clientId: string;
  serverId: string;
}

export interface MigrationResult {
  paystubs: MigrationIdMap[];
  debts: MigrationIdMap[];
  bills: MigrationIdMap[];
  assets: MigrationIdMap[];
}

export type MigrationStatus = "pending" | "committed" | "failed";

export interface MigrationJobResponse {
  idempotencyKey: string;
  status: MigrationStatus;
  result?: MigrationResult;
  errorMessage?: string;
  committedAt?: string;
  createdAt?: string;
}

/**
 * POST /api/migrate — submit a bulk local→server migration.
 * Idempotent: re-submitting the same idempotencyKey returns the original result.
 */
export async function startMigration(
  token: string,
  payload: {
    idempotencyKey: string;
    profile?: Record<string, unknown>;
    paystubs: Array<{ clientId: string } & Record<string, unknown>>;
    debts: Array<{ clientId: string } & Record<string, unknown>>;
    bills: Array<{ clientId: string } & Record<string, unknown>>;
    assets: Array<{ clientId: string } & Record<string, unknown>>;
  },
): Promise<MigrationJobResponse> {
  const res = await financialFetch("/migrate", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(
      (json as any).error ?? `Migration failed (${res.status})`,
    );
  }
  return res.json();
}

/**
 * GET /api/migrate/status/:key — poll for migration result.
 * Call this after a disconnect to check whether the server committed.
 * Returns a MigrationJobResponse with status 'failed' if the key is not found.
 */
export async function getMigrationStatus(
  token: string,
  idempotencyKey: string,
): Promise<MigrationJobResponse> {
  const res = await financialFetch(
    `/migrate/status/${encodeURIComponent(idempotencyKey)}`,
    token,
  );
  if (res.status === 404) {
    return {
      idempotencyKey,
      status: "failed",
      errorMessage: "Migration not found. Please try again.",
    };
  }
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(
      (json as any).error ?? `Status check failed (${res.status})`,
    );
  }
  return res.json();
}

// ─── Financial API ─────────────────────────────────────────────────────────────
// All financial endpoints require a verified Clerk session token.

export interface FinancialSnapshot {
  profile: Record<string, unknown> | null;
  paystubs: Record<string, unknown>[];
  debts: Record<string, unknown>[];
  bills: Record<string, unknown>[];
  assets: Record<string, unknown>[];
}

/**
 * Base fetch wrapper for authenticated financial endpoints.
 * Throws a descriptive Error on non-OK responses.
 */
async function financialFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  const isBodyless =
    options.method === "DELETE" ||
    options.method === "GET" ||
    !options.method;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(isBodyless ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    } as HeadersInit,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as any).error ?? `Financial API error ${res.status} at ${path}`,
    );
  }
  return res;
}

/** Load the authenticated user's full financial snapshot. */
export async function loadSnapshot(token: string): Promise<FinancialSnapshot> {
  const res = await financialFetch("/financial/snapshot", token);
  return res.json();
}

/** Upsert the authenticated user's profile. */
export async function saveProfile(
  token: string,
  profile: Record<string, unknown>,
): Promise<void> {
  await financialFetch("/financial/profile", token, {
    method: "PUT",
    body: JSON.stringify(profile),
  });
}

/** Create a financial record and return the server-assigned row. */
export async function createRecord(
  token: string,
  section: "paystubs" | "debts" | "bills" | "assets",
  data: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await financialFetch(`/financial/${section}`, token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.json();
}

/** Update a financial record (debts, bills, assets only — paystubs are immutable). */
export async function updateRecord(
  token: string,
  section: "debts" | "bills" | "assets",
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await financialFetch(`/financial/${section}/${id}`, token, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/** Soft-delete a financial record. */
export async function deleteRecord(
  token: string,
  section: "paystubs" | "debts" | "bills" | "assets",
  id: string,
): Promise<void> {
  await financialFetch(`/financial/${section}/${id}`, token, {
    method: "DELETE",
  });
}
