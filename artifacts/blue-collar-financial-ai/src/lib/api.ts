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

/** Normalized bank-statement extraction returned for Bank Statement / Checking / Savings docs. */
export interface BankStatementExtraction {
  documentType: "bankStatement";
  institution: string | null;
  accountName: string | null;
  lastFour: string | null;
  closingBalance: number | null;
  currentBalance: number | null;
  availableBalance: number | null;
  statementStartDate: string | null;
  statementEndDate: string | null;
  apy: number | null;
  confidence: Record<string, number>;
}

// ─── Extraction gate types (mirrors api-server/src/lib/extraction-field.ts) ──

export type WarningSeverity = 'blocking' | 'advisory';

export interface ConfidenceFlag {
  field: string;
  label: string;
  category: string;
  required: boolean;
  actualConfidence: number | null;
  minimumRequired: number;
  severity: WarningSeverity;
  message: string;
}

export interface ReconciliationWarning {
  rule: string;
  fields: string[];
  message: string;
  severity: WarningSeverity;
  computedDelta?: number;
}

export interface ErrorPatternFlag {
  pattern: string;
  field: string;
  label: string;
  rawValue: string | number | null;
  suggestedValue?: string | number;
  message: string;
  severity: WarningSeverity;
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
  /** Set when the server used a document fast path. */
  success?: boolean;
  type?: string;
  documentType?: string;
  data?: VehicleLoanExtraction | BankStatementExtraction | Record<string, unknown>;
  extraction?: VehicleLoanExtraction | BankStatementExtraction | Record<string, unknown>;
  /** Extraction accuracy gate — populated by the server for every successful scan. */
  confidenceFlags?: ConfidenceFlag[];
  reconciliationWarnings?: ReconciliationWarning[];
  errorPatternFlags?: ErrorPatternFlag[];
  hasBlockingIssues?: boolean;
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
  signal?: AbortSignal,
): Promise<ScanResult> {
  const form = new FormData();
  // Always pass filename explicitly so multer receives originalname correctly
  // even when the browser omits it (common on iOS Safari).
  form.append("file", file, file.name);

  console.log(
    `[BCFAI] API request sent — ${file.name} ` +
    `(${(file.size / 1024).toFixed(1)} KB, type="${file.type || "unknown"}")`,
  );

  let res: Response;
  try {
    // Do NOT set Content-Type manually — let fetch generate the multipart boundary.
    res = await fetch(`${API_BASE}/scan-document`, {
      method: "POST",
      body: form,
      headers: authedHeaders(token),
      signal,
    });
  } catch (err) {
    const isTimeout =
      err instanceof DOMException && err.name === "TimeoutError";
    const isAbort =
      err instanceof DOMException && err.name === "AbortError";
    if (isTimeout || isAbort) {
      console.warn(
        `[BCFAI] ${isTimeout ? "timeout" : "abort"} — ${file.name}`,
      );
    }
    throw new Error(
      JSON.stringify({
        stage: isTimeout || isAbort ? "scan_timeout" : "upload_request",
        message: isTimeout
          ? "Document analysis timed out after 60 seconds. Please try a smaller or clearer document."
          : isAbort
          ? "Scan was cancelled."
          : err instanceof Error
          ? err.message
          : "Network error — check your connection",
        filename: file.name,
        retryable: true,
      }),
    );
  }

  console.log(
    `[BCFAI] API response received — ${file.name} — HTTP ${res.status}`,
  );

  let json: unknown;
  try {
    json = await res.clone().json();
  } catch (parseErr) {
    const rawText = await res.text().catch(() => "<could not read body>");
    console.warn(
      `[BCFAI] JSON parse error — ${file.name}: ${parseErr}`,
      "body:", rawText.slice(0, 500),
    );
    throw new Error(
      JSON.stringify({
        stage: "json_parse",
        message: `Response body is not valid JSON (HTTP ${res.status}): ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        filename: file.name,
      }),
    );
  }

  if (!res.ok) {
    const retryAfterHeader = res.headers.get("retry-after");
    // Some APIs return retryAfterMs (milliseconds) in the JSON body.
    const retryAfterBodyMs =
      typeof (json as any)?.retryAfterMs === "number"
        ? ((json as any).retryAfterMs as number)
        : undefined;
    throw new Error(
      JSON.stringify({
        stage: (json as any).stage ?? "backend_receipt",
        message:
          (json as any).error ??
          (json as any).message ??
          `Upload failed with HTTP ${res.status}`,
        filename: file.name,
        httpStatus: res.status,
        // Pass retryable flag from server response so the frontend can decide
        // whether to show a Retry button. Undefined = unknown (treat as retryable).
        retryable: (json as any).retryable,
        ...(retryAfterHeader !== null ? { retryAfterHeader } : {}),
        ...(retryAfterBodyMs !== undefined ? { retryAfterBodyMs } : {}),
      }),
    );
  }
  return json as ScanResult;
}

// ─── Capabilities ─────────────────────────────────────────────────────────────

/**
 * Check whether the AI backend is available.
 * Requires a Clerk session token — without one the endpoint returns 401
 * and we report AI as unavailable.
 */
export async function checkCapabilities(
  token?: string | null,
): Promise<{ ai: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/capabilities`, {
      headers: authedHeaders(token),
    });
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

// ─── Tax Scenarios ─────────────────────────────────────────────────────────────

export interface TaxScenario {
  id: string;
  name: string;
  taxYear: number;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

async function taxFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.method && options.method !== "GET"
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Tax scenario request failed (${res.status})`,
    );
  }
  return res;
}

/** List all saved tax scenarios for the authenticated user. */
export async function listTaxScenarios(token: string): Promise<TaxScenario[]> {
  const res = await taxFetch("/tax-scenarios", token);
  const body = (await res.json()) as { scenarios: TaxScenario[] };
  return body.scenarios;
}

/** Save a new tax scenario. */
export async function createTaxScenario(
  token: string,
  data: { name: string; taxYear: number; inputs: Record<string, unknown>; result: Record<string, unknown> },
): Promise<TaxScenario> {
  const res = await taxFetch("/tax-scenarios", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
  const body = (await res.json()) as { scenario: TaxScenario };
  return body.scenario;
}

/** Update an existing tax scenario (name / inputs / result). */
export async function updateTaxScenario(
  token: string,
  id: string,
  data: Partial<{ name: string; inputs: Record<string, unknown>; result: Record<string, unknown> }>,
): Promise<TaxScenario> {
  const res = await taxFetch(`/tax-scenarios/${id}`, token, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  const body = (await res.json()) as { scenario: TaxScenario };
  return body.scenario;
}

/** Soft-delete a saved tax scenario. */
export async function deleteTaxScenario(token: string, id: string): Promise<void> {
  await taxFetch(`/tax-scenarios/${id}`, token, { method: "DELETE" });
}

// ─── Command Center ────────────────────────────────────────────────────────────

export interface CommandCenterMetric {
  value: number | null;
  status: "ready" | "missing";
}

export interface CommandCenterNextBestMove {
  category: "income" | "cash-flow" | "emergency-fund" | "debt" | "credit" | "retirement" | "tax" | "complete-profile";
  title: string;
  detail: string;
  estimatedImpact: number | null;
  route: string;
}

export interface CommandCenterTaxEstimate {
  totalEstimatedTax?: number | null;
  refundOrAmountOwed?: number | null;
  effectiveTaxRate?: number | null;
  confidence?: "low" | "medium" | "high" | null;
}

export interface CommandCenterSummaryResponse {
  generatedAt: string;
  netWorth: CommandCenterMetric;
  cash: CommandCenterMetric;
  investments: CommandCenterMetric;
  retirement: CommandCenterMetric;
  debt: CommandCenterMetric;
  monthlyCashFlow: CommandCenterMetric;
  monthlyIncome: CommandCenterMetric;
  monthlyBills: CommandCenterMetric;
  monthlyDebtPayments: CommandCenterMetric;
  creditUtilization: CommandCenterMetric;
  emergencyFundMonths: CommandCenterMetric;
  healthScore: number | null;
  taxEstimate: CommandCenterTaxEstimate | null;
  nextBestMove: CommandCenterNextBestMove;
  missingData: string[];
}

/** Load the authenticated user's Financial Command Center summary from the server. */
export async function getCommandCenterSummary(token: string): Promise<CommandCenterSummaryResponse> {
  const res = await financialFetch("/command-center/summary", token);
  return res.json() as Promise<CommandCenterSummaryResponse>;
}

// ─── Financial Timeline ────────────────────────────────────────────────────────

export interface TimelineEvent {
  id: string;
  userId: string;
  eventType: string;
  eventDate: string; // ISO string from server
  sourceRecordType: string;
  sourceRecordId: string | null;
  previousValue: number | null;
  newValue: number | null;
  changeAmount: number | null;
  title: string;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface MonthlyTrends {
  cash: number | null;
  debt: number | null;
  investments: number | null;
  retirement: number | null;
  netWorth: number | null;
  estimatedTax: number | null;
}

export interface TimelineSummaryResponse {
  generatedAt: string;
  events: TimelineEvent[];
  monthlyTrends: MonthlyTrends;
}

/** Load the authenticated user's financial timeline. */
export async function getTimelineSummary(token: string): Promise<TimelineSummaryResponse> {
  const res = await financialFetch("/timeline/summary", token);
  return res.json() as Promise<TimelineSummaryResponse>;
}

// ─── Financial Health Score ───────────────────────────────────────────────────

export type CategoryStatus = 'excellent' | 'good' | 'fair' | 'needs_work' | 'missing';

export interface HealthCategory {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  pct: number;
  status: CategoryStatus;
  explanation: string;
  hasData: boolean;
}

export interface HealthRecommendation {
  category: string;
  title: string;
  detail: string;
  route: string;
}

export interface HealthScoreResult {
  score: number | null;
  rawScore: number;
  maxPossible: number;
  confidence: number;
  categories: HealthCategory[];
  recommendation: HealthRecommendation;
}

export interface HealthScoreDetailResponse {
  generatedAt: string;
  healthScore: HealthScoreResult;
}

export interface HealthScoreHistoryEntry {
  month: string;
  score: number | null;
  confidence: number | null;
  capturedAt: string;
}

export interface HealthScoreHistoryResponse {
  history: HealthScoreHistoryEntry[];
}

/** Load the full 10-category health score breakdown. */
export async function getHealthScoreDetail(token: string): Promise<HealthScoreDetailResponse> {
  const res = await financialFetch("/health-score/detail", token);
  return res.json() as Promise<HealthScoreDetailResponse>;
}

/** Load monthly health score history. */
export async function getHealthScoreHistory(token: string): Promise<HealthScoreHistoryResponse> {
  const res = await financialFetch("/health-score/history", token);
  return res.json() as Promise<HealthScoreHistoryResponse>;
}

// ─── Weekly Financial Snapshot ────────────────────────────────────────────────

export interface WeeklySnapshotSummary {
  weekStart: string;
  weekEnd: string;
  sentences: string[];
  trends: MonthlyTrends;
  capturedAt: string;
}

export interface StoredWeeklySnapshot {
  id: string;
  weekStart: string;
  weekEnd: string;
  sentences: string[];
  trends: MonthlyTrends;
  capturedAt: string;
}

export interface WeeklySnapshotCurrentResponse {
  generatedAt: string;
  current: WeeklySnapshotSummary;
  healthScore: number | null;
  healthConfidence: number;
}

export interface WeeklySnapshotHistoryResponse {
  history: StoredWeeklySnapshot[];
}

/** Get this week's financial snapshot (auto-generated from timeline events). */
export async function getWeeklySnapshotCurrent(token: string): Promise<WeeklySnapshotCurrentResponse> {
  const res = await financialFetch("/weekly-snapshot/current", token);
  return res.json() as Promise<WeeklySnapshotCurrentResponse>;
}

/** Get past weekly snapshots. */
export async function getWeeklySnapshotHistory(token: string): Promise<WeeklySnapshotHistoryResponse> {
  const res = await financialFetch("/weekly-snapshot/history", token);
  return res.json() as Promise<WeeklySnapshotHistoryResponse>;
}
