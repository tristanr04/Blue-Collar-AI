// API client — all calls go to the API server artifact at /api-server
// In Replit path-based routing, this resolves correctly through the shared proxy.

const API_BASE = "/api-server/api";

export interface ScanFieldValue {
  value: string | number | boolean | null;
  confidence: number;
  sourceText?: string;
}

export interface ScanResult {
  docType: string;
  classificationConfidence: number;
  fields: Record<string, ScanFieldValue>;
  fileName: string;
  mimeType: string;
  error?: string;
}

/** Upload a single file and get AI extraction results. */
export async function scanFile(file: File): Promise<ScanResult> {
  const form = new FormData();
  // Always pass the filename explicitly so multer receives originalname correctly
  // even when the browser omits it (common on iOS Safari).
  form.append("file", file, file.name);

  let res: Response;
  try {
    // Do NOT set Content-Type manually — let fetch generate the multipart boundary.
    res = await fetch(`${API_BASE}/scan`, { method: "POST", body: form });
  } catch (err) {
    throw new Error(
      JSON.stringify({
        stage: "upload_request",
        message: err instanceof Error ? err.message : "Network error — check your connection",
        filename: file.name,
      })
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
        message: (json as any).error ?? (json as any).message ?? `Upload failed with HTTP ${res.status}`,
        filename: file.name,
      })
    );
  }
  return json as ScanResult;
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
