// API client — all calls go to the API server artifact at /api-server
// In Replit path-based routing, this resolves correctly through the shared proxy.

// Replit path routing: artifact.toml maps paths=["/api"] to the API server on
// port 8080. The Vite dev server also proxies /api → 8080 (see vite.config.ts).
// Never use /api-server/... — that prefix is not a registered service path.
const API_BASE = "/api";

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

export interface ScanResult {
  docType: string;
  classificationConfidence: number;
  fields: Record<string, ScanFieldValue>;
  institution?: InstitutionInfo;
  unknownFields?: UnknownField[];
  fileName: string;
  mimeType: string;
  error?: string;
}

/** Let React commit the queued/processing UI before beginning a potentially long request. */
function waitForPaint(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateScanResult(value: unknown, fallbackFileName: string): ScanResult {
  if (!isRecord(value)) {
    throw new Error(JSON.stringify({
      stage: "response_validation",
      message: "The scanner returned an invalid response.",
      filename: fallbackFileName,
    }));
  }

  const docType = typeof value.docType === "string" && value.docType.trim()
    ? value.docType.trim()
    : "Unknown";
  const classificationConfidence = typeof value.classificationConfidence === "number"
    && Number.isFinite(value.classificationConfidence)
    ? value.classificationConfidence
    : 0;
  const fields = isRecord(value.fields)
    ? value.fields as Record<string, ScanFieldValue>
    : {};

  // A parse failure from the backend must be surfaced as a failed document,
  // not accepted as a blank successful review card.
  if (value.parseError === true) {
    throw new Error(JSON.stringify({
      stage: "response_validation",
      message: "The AI returned malformed extraction data. Retry this document.",
      filename: fallbackFileName,
    }));
  }

  return {
    ...value,
    docType,
    classificationConfidence,
    fields,
    fileName: typeof value.fileName === "string" && value.fileName
      ? value.fileName
      : fallbackFileName,
    mimeType: typeof value.mimeType === "string" ? value.mimeType : "",
  } as ScanResult;
}

async function readJsonResponse(res: Response, fileName: string): Promise<unknown> {
  const raw = await res.text();
  if (!raw.trim()) {
    throw new Error(JSON.stringify({
      stage: "response_validation",
      message: `Scanner returned an empty response (HTTP ${res.status}).`,
      filename: fileName,
    }));
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(JSON.stringify({
      stage: "response_validation",
      message: `Scanner returned non-JSON data (HTTP ${res.status}).`,
      filename: fileName,
    }));
  }
}

/** Upload a single file and get AI extraction results. */
export async function scanFile(file: File): Promise<ScanResult> {
  if (!(file instanceof File) || file.size === 0) {
    throw new Error(JSON.stringify({
      stage: "file_validation",
      message: "This file is empty or unreadable.",
      filename: file?.name ?? "unknown",
    }));
  }

  // Scanner.tsx marks the document as processing immediately before this call.
  // Yielding one frame prevents React's state updates from remaining batched while
  // the first network request is pending, which previously left every card shown
  // as "Queued" even though the processing loop had started.
  await waitForPaint();

  const form = new FormData();
  // Always pass the filename explicitly so multer receives originalname correctly
  // even when the browser omits it (common on iOS Safari).
  form.append("file", file, file.name || "document");

  const controller = new AbortController();
  const timeoutMs = 60_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    // Do NOT set Content-Type manually — let fetch generate the multipart boundary.
    res = await fetch(`${API_BASE}/scan-document`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    throw new Error(
      JSON.stringify({
        stage: timedOut ? "timeout" : "upload_request",
        message: timedOut
          ? `Scanning timed out after ${timeoutMs / 1000} seconds`
          : err instanceof Error
            ? err.message
            : "Network error — check your connection",
        filename: file.name,
      })
    );
  } finally {
    clearTimeout(timeout);
  }

  const json = await readJsonResponse(res, file.name);

  if (!res.ok) {
    const errorJson = isRecord(json) ? json : {};
    throw new Error(
      JSON.stringify({
        stage: typeof errorJson.stage === "string" ? errorJson.stage : "backend_receipt",
        message:
          (typeof errorJson.error === "string" && errorJson.error) ||
          (typeof errorJson.message === "string" && errorJson.message) ||
          `Upload failed with HTTP ${res.status}`,
        filename: file.name,
      })
    );
  }

  return validateScanResult(json, file.name);
}

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

/** Ask the AI financial assistant a question with the user's confirmed data. */
export async function askAI(
  question: string,
  financialProfile: Record<string, unknown>,
  onDelta: (text: string) => void
): Promise<void> {
  const res = await fetch(`${API_BASE}/ai/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, financialProfile }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as any).error ?? "AI request failed");
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
      try {
        const parsed = JSON.parse(payload);
        if (parsed.delta) onDelta(parsed.delta);
        if (parsed.error) throw new Error(parsed.error);
      } catch {
        // ignore parse errors on individual SSE lines
      }
    }
  }
}
