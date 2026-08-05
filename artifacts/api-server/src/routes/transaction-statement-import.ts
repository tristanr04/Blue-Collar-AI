import { Router, type IRouter } from "express";
import multer from "multer";
import OpenAI from "openai";
import { createRequire } from "node:module";
import { importCsvTransactions, type MerchantRule } from "../lib/transaction-import.js";
import { logger } from "../lib/logger.js";

const require = createRequire(import.meta.url);
const pdfParse: (buffer: Buffer) => Promise<{ text: string }> = require("pdf-parse");

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

const EXTRACTION_PROMPT = `You extract transaction rows from bank statements, credit-card statements, and transaction-history screenshots.

Handle blurry, skewed, sideways, upside-down, cropped, low-contrast, and partially visible images. Inspect all four orientations before deciding the image is unreadable.

Return exactly one JSON object with this shape:
{
  "institution": "Example Bank",
  "accountLastFour": "1234",
  "statementStartDate": "2026-07-01",
  "statementEndDate": "2026-07-31",
  "transactions": [
    {
      "postedDate": "2026-07-03",
      "description": "QUIKTRIP 0123",
      "signedAmount": -63.10,
      "confidence": 96
    }
  ],
  "warnings": []
}

Rules:
- signedAmount must be negative for money leaving the account and positive for money entering it.
- Preserve refunds, card payments, transfers, deposits, fees, and reversals as separate rows. Downstream logic will classify them.
- Never invent a date, merchant, amount, or account number.
- If a row is partially visible, omit it rather than guessing.
- Dates must be YYYY-MM-DD.
- accountLastFour must remain a string.
- confidence must be 0 through 100.
- Do not return balances, subtotals, rewards, interest summaries, statement totals, minimum payments, or credit limits as transactions.
- Do not merge multiple transactions into one row.
- Return JSON only, with no markdown.`;

type ExtractedRow = {
  postedDate?: unknown;
  description?: unknown;
  signedAmount?: unknown;
  confidence?: unknown;
};

type ExtractionPayload = {
  institution?: unknown;
  accountLastFour?: unknown;
  statementStartDate?: unknown;
  statementEndDate?: unknown;
  transactions?: unknown;
  warnings?: unknown;
};

function detectMime(buffer: Buffer): string {
  const h = buffer.subarray(0, 16);
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return "image/jpeg";
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return "image/png";
  if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46) return "image/webp";
  if (h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) return "application/pdf";
  return "application/octet-stream";
}

function parseJson(raw: string): ExtractionPayload {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const parsed = JSON.parse(candidate) as ExtractionPayload;
  if (!parsed || typeof parsed !== "object") throw new Error("Transaction extraction returned invalid JSON.");
  return parsed;
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function extractedRowsToCsv(rows: ExtractedRow[]): { csv: string; confidenceByKey: Map<string, number>; rejected: number } {
  const lines = ["Date,Description,Amount"];
  const confidenceByKey = new Map<string, number>();
  let rejected = 0;

  for (const row of rows) {
    const postedDate = typeof row.postedDate === "string" ? row.postedDate.trim() : "";
    const description = typeof row.description === "string" ? row.description.trim() : "";
    const signedAmount = typeof row.signedAmount === "number" ? row.signedAmount : Number(row.signedAmount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(postedDate) || !description || !Number.isFinite(signedAmount) || signedAmount === 0) {
      rejected += 1;
      continue;
    }
    const confidence = typeof row.confidence === "number" && Number.isFinite(row.confidence)
      ? Math.max(0, Math.min(100, row.confidence))
      : 50;
    lines.push([postedDate, csvEscape(description), signedAmount.toFixed(2)].join(","));
    confidenceByKey.set(`${postedDate}|${description}|${Math.abs(signedAmount).toFixed(2)}`, confidence);
  }

  return { csv: lines.join("\n"), confidenceByKey, rejected };
}

async function extractFromPdf(buffer: Buffer): Promise<ExtractionPayload> {
  const parsed = await pdfParse(buffer);
  if (!parsed.text || parsed.text.trim().length < 80) {
    throw new Error("This PDF has no readable text. Upload page screenshots instead.");
  }
  const response = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    response_format: { type: "json_object" },
    max_completion_tokens: 5000,
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: `Extract every transaction from this statement text:\n\n${parsed.text.slice(0, 30000)}` },
    ],
  });
  return parseJson(response.choices[0]?.message?.content ?? "");
}

async function extractFromImage(buffer: Buffer, mime: string): Promise<ExtractionPayload> {
  const response = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    response_format: { type: "json_object" },
    max_completion_tokens: 5000,
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract every clearly visible transaction from this image. Check all four rotations and preserve the sign of each amount." },
          { type: "image_url", image_url: { url: `data:${mime};base64,${buffer.toString("base64")}`, detail: "high" } },
        ],
      },
    ],
  });
  return parseJson(response.choices[0]?.message?.content ?? "");
}

router.post("/transactions/import/statement", upload.single("file"), async (req, res) => {
  if (!req.file?.buffer?.length) {
    res.status(400).json({ error: "Upload a PDF statement or transaction screenshot." });
    return;
  }

  let mime = detectMime(req.file.buffer);
  if (mime === "application/octet-stream") {
    const ext = req.file.originalname.split(".").pop()?.toLowerCase();
    if (ext === "pdf") mime = "application/pdf";
    else if (ext === "jpg" || ext === "jpeg") mime = "image/jpeg";
    else if (ext === "png") mime = "image/png";
    else if (ext === "webp") mime = "image/webp";
  }

  if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(mime)) {
    res.status(422).json({ error: "Upload a PDF, JPG, PNG, or WEBP transaction statement." });
    return;
  }

  try {
    const merchantRules = typeof req.body.merchantRules === "string"
      ? JSON.parse(req.body.merchantRules) as MerchantRule[]
      : [];
    const existingFingerprints = typeof req.body.existingFingerprints === "string"
      ? JSON.parse(req.body.existingFingerprints) as string[]
      : [];

    const extracted = mime === "application/pdf"
      ? await extractFromPdf(req.file.buffer)
      : await extractFromImage(req.file.buffer, mime);

    const rows = Array.isArray(extracted.transactions) ? extracted.transactions as ExtractedRow[] : [];
    if (!rows.length) {
      res.status(422).json({
        error: "No complete transaction rows were readable in this file.",
        warnings: Array.isArray(extracted.warnings) ? extracted.warnings : [],
      });
      return;
    }

    const accountLastFour = typeof extracted.accountLastFour === "string"
      ? extracted.accountLastFour.replace(/\D/g, "").slice(-4) || null
      : null;
    const converted = extractedRowsToCsv(rows);
    const imported = importCsvTransactions({
      csv: converted.csv,
      sourceFile: req.file.originalname,
      accountLastFour,
      merchantRules,
      existingFingerprints,
    });

    const transactions = imported.transactions.map(transaction => {
      const key = `${transaction.postedDate}|${transaction.descriptionRaw}|${transaction.amount.toFixed(2)}`;
      const extractionConfidence = converted.confidenceByKey.get(key) ?? 50;
      return {
        ...transaction,
        source: mime === "application/pdf" ? "statement" : "screenshot",
        extractionConfidence,
        needsReview: transaction.needsReview || extractionConfidence < 75,
      };
    });

    const warnings = [
      ...imported.warnings,
      ...(Array.isArray(extracted.warnings) ? extracted.warnings.filter((value): value is string => typeof value === "string") : []),
    ];
    if (converted.rejected) warnings.push(`${converted.rejected} incomplete extracted row(s) were omitted.`);

    logger.info({
      file: req.file.originalname,
      mime,
      extractedRows: rows.length,
      importedRows: transactions.length,
      duplicatesSkipped: imported.duplicatesSkipped,
      rejectedRows: imported.rejectedRows + converted.rejected,
    }, "statement transaction import complete");

    res.json({
      institution: typeof extracted.institution === "string" ? extracted.institution : null,
      accountLastFour,
      statementStartDate: typeof extracted.statementStartDate === "string" ? extracted.statementStartDate : null,
      statementEndDate: typeof extracted.statementEndDate === "string" ? extracted.statementEndDate : null,
      sourceType: mime === "application/pdf" ? "statement" : "screenshot",
      transactions,
      duplicatesSkipped: imported.duplicatesSkipped,
      rejectedRows: imported.rejectedRows + converted.rejected,
      warnings,
      reviewRequired: transactions.some(transaction => transaction.needsReview),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transaction extraction failed.";
    logger.error({ error, file: req.file.originalname }, "statement transaction import failed");
    res.status(500).json({ error: message });
  }
});

export default router;
