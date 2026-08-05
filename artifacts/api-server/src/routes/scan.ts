import { Router, type IRouter } from "express";
import multer from "multer";
import OpenAI from "openai";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = _require("pdf-parse");
import { logger } from "../lib/logger.js";
import { normalizeInstitution } from "../lib/institution-registry.js";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

function detectMime(buffer: Buffer): string {
  const h = buffer.subarray(0, 16);
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return "image/jpeg";
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return "image/png";
  if (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46) return "image/gif";
  if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46) return "image/webp";
  if (h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) return "application/pdf";
  if (buffer.length > 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") return "image/heic";
  return "application/octet-stream";
}

const SYSTEM_PROMPT = `You are a forensic financial document extraction AI. Analyze difficult real-world photos and scans, including images that are blurry, low contrast, dim, overexposed, skewed, cropped, sideways, upside down, wrinkled, photographed at an angle, or partially obstructed.

Before extracting data, inspect the page in all four orientations (0, 90, 180, and 270 degrees). Mentally deskew perspective and distinguish printed labels from values. Read repeated context, table structure, currency formatting, and nearby labels to recover legible information, but never invent or estimate a value that is not actually visible.

Respond with exactly one valid JSON object. Do not use markdown, code fences, commentary, or multiple objects.

Classify docType as exactly one of:
Paystub | Checking Account | Savings Account | High-Yield Savings | Money Market Account | Certificate of Deposit | Cash Management Account | Bank Statement | Credit Card | Credit Card Statement | Line of Credit | Auto Loan | Personal Loan | Mortgage | HELOC | Student Loan | Brokerage Account | Margin Account | Robo-Adviser Account | Employee Stock Plan | 401(k) | Roth 401(k) | 403(b) | 457(b) | Traditional IRA | Roth IRA | SEP IRA | SIMPLE IRA | Rollover IRA | Pension | Thrift Savings Plan | HSA Investment Account | Monthly Bill | Utility Bill | Unknown

Extract the institution exactly as printed. Unknown institutions are valid.
Return only fields clearly visible. Never estimate or calculate. Use plain numbers without currency symbols, commas, or percent signs. Dates must be YYYY-MM-DD. Set unclear values to null.

Return this shape:
{
  "docType": "Credit Card Statement",
  "classificationConfidence": 95,
  "detectedOrientation": 0,
  "imageQuality": "good",
  "qualityWarnings": [],
  "institution": { "rawName": "Example Bank", "isKnownInstitution": false },
  "fields": {
    "currentBalance": { "value": 1200.25, "confidence": 95, "sourceText": "Current Balance $1,200.25" }
  },
  "unknownFields": []
}

imageQuality must be one of: excellent | good | fair | poor | unreadable.
detectedOrientation must be one of: 0 | 90 | 180 | 270.
qualityWarnings may include concise values such as blur, glare, low_contrast, cropped, perspective_skew, partial_obstruction, tiny_text, or rotation_uncertain.

Relevant fields:
PAYSTUB: employer, payDate, payPeriodStart, payPeriodEnd, hourlyRate, regularHours, overtimeHours, doubleTimeHours, perDiem, standbyPay, bonus, grossPay, federalTax, stateTax, socialSecurity, medicare, unionDues, insuranceDeductions, retirementContribution, retirementRate, otherDeductions, netPay
BANKING: institution, accountType, accountName, lastFour, currentBalance, availableBalance, pendingBalance, apy, interestEarned, statementDate, statementStartDate, statementEndDate, openingBalance, closingBalance, totalDeposits, totalWithdrawals
CREDIT CARD: issuer, accountName, lastFour, currentBalance, statementBalance, creditLimit, availableCredit, apr, minimumPayment, dueDate, autopay
LOANS: lender, servicer, loanName, loanType, lastFour, currentBalance, originalAmount, apr, interestRate, monthlyPayment, remainingTermMonths, originalTermMonths, nextDueDate, payoffAmount
MORTGAGE/HELOC: lender, propertyAddress, principalBalance, originalLoanAmount, interestRate, monthlyPayment, principalAndInterest, escrowAmount, nextDueDate, remainingTermMonths, propertyValue, creditLimit, currentBalance, availableCredit, drawPeriodEnd
BROKERAGE/INVESTMENT: institution, accountType, lastFour, totalValue, securitiesValue, cashBalance, buyingPower, marginBalance, marginAvailable, marginInterestRate, dayChange, totalReturn, unrealizedGain, realizedGain, statementDate
RETIREMENT: institution, employer, planName, planType, lastFour, currentBalance, vestedBalance, employeeContributionRate, rothContributionRate, pretaxContributionRate, employeeYtdContributions, employerYtdContributions, employerMatchFormula, employerMatchAmount, vestingPercent, vestingSchedule, outstandingLoanBalance, loanPayment, statementDate
BILLS: provider, category, amountDue, dueDate, billingFrequency, billingPeriod, recurringFrequency, autopay, lastFour`;

type ExtractionAttempt = {
  raw: string;
  finishReason: string | null;
  promptTokens?: number;
  completionTokens?: number;
  strategy: string;
};

type ScoredExtraction = {
  result: Record<string, unknown>;
  score: number;
  strategy: string;
};

const ORIENTATION_STRATEGIES = [
  { name: "normal", instruction: "Inspect the image normally, but verify all four possible rotations before deciding its orientation." },
  { name: "rotate-90", instruction: "Treat the page as likely rotated 90 degrees. Mentally rotate it clockwise, deskew it, and extract every readable field." },
  { name: "rotate-180", instruction: "Treat the page as likely upside down. Mentally rotate it 180 degrees and extract every readable field." },
  { name: "rotate-270", instruction: "Treat the page as likely rotated 270 degrees. Mentally rotate it counterclockwise, deskew it, and extract every readable field." },
] as const;

async function extractFromImage(
  buffer: Buffer,
  mimeType: string,
  strategy: string,
  instruction: string,
  recovery = false,
): Promise<ExtractionAttempt> {
  const b64 = buffer.toString("base64");
  const response = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    max_completion_tokens: recovery ? 4096 : 3072,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${instruction}\n${recovery ? "This is a recovery pass. Slow down, inspect small text, repeated labels, table alignment, and all four rotations. Prefer null over guessing, but do not give up on readable text." : "Extract all visible financial data and return one complete JSON object."}`,
          },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${b64}`, detail: "high" } },
        ],
      },
    ],
  });

  return {
    raw: response.choices[0]?.message?.content ?? "",
    finishReason: response.choices[0]?.finish_reason ?? null,
    promptTokens: response.usage?.prompt_tokens,
    completionTokens: response.usage?.completion_tokens,
    strategy,
  };
}

async function extractFromText(text: string, retry = false): Promise<ExtractionAttempt> {
  const response = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    max_completion_tokens: retry ? 4096 : 3072,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `${retry ? "This is a recovery pass. " : ""}Extract all visible financial data from this PDF text and return exactly one complete JSON object:\n\n${text.slice(0, 16000)}`,
      },
    ],
  });

  return {
    raw: response.choices[0]?.message?.content ?? "",
    finishReason: response.choices[0]?.finish_reason ?? null,
    promptTokens: response.usage?.prompt_tokens,
    completionTokens: response.usage?.completion_tokens,
    strategy: retry ? "pdf-recovery" : "pdf-primary",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractJsonCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const candidates = new Set<string>();
  candidates.add(trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim());

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.add(trimmed.slice(first, last + 1));

  const balanced: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) balanced.push(trimmed.slice(start, i + 1));
    }
  }
  balanced.sort((a, b) => b.length - a.length).forEach(candidate => candidates.add(candidate));
  return [...candidates];
}

function parseExtraction(raw: string): Record<string, unknown> | null {
  for (const candidate of extractJsonCandidates(raw)) {
    const variants = [candidate, candidate.replace(/,\s*([}\]])/g, "$1")];
    for (const variant of variants) {
      try {
        const parsed: unknown = JSON.parse(variant);
        if (isRecord(parsed)) return parsed;
      } catch {
        // Try the next repair candidate.
      }
    }
  }
  return null;
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function validateExtraction(result: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof result.docType !== "string" || !result.docType.trim()) return null;
  if (!isRecord(result.fields)) result.fields = {};
  result.classificationConfidence = normalizeConfidence(result.classificationConfidence);

  if (![0, 90, 180, 270].includes(Number(result.detectedOrientation))) {
    result.detectedOrientation = 0;
  }
  if (!["excellent", "good", "fair", "poor", "unreadable"].includes(String(result.imageQuality))) {
    result.imageQuality = "fair";
  }
  if (!Array.isArray(result.qualityWarnings)) result.qualityWarnings = [];
  if (!Array.isArray(result.unknownFields)) result.unknownFields = [];

  return result;
}

function scoreExtraction(result: Record<string, unknown>): number {
  const fields = isRecord(result.fields) ? result.fields : {};
  const fieldEntries = Object.values(fields).filter(isRecord);
  const populated = fieldEntries.filter(field => field.value !== null && field.value !== undefined && field.value !== "");
  const avgFieldConfidence = populated.length
    ? populated.reduce((sum, field) => sum + normalizeConfidence(field.confidence), 0) / populated.length
    : 0;

  const classification = normalizeConfidence(result.classificationConfidence);
  const institutionBonus = isRecord(result.institution) && typeof result.institution.rawName === "string" && result.institution.rawName.trim() ? 8 : 0;
  const docTypeBonus = result.docType !== "Unknown" ? 8 : 0;
  const populatedBonus = Math.min(42, populated.length * 4.2);
  const confidenceBonus = Math.min(24, avgFieldConfidence * 0.24);
  const classificationBonus = Math.min(18, classification * 0.18);
  const qualityPenalty = result.imageQuality === "unreadable" ? 35 : result.imageQuality === "poor" ? 15 : 0;

  return Math.max(0, populatedBonus + confidenceBonus + classificationBonus + institutionBonus + docTypeBonus - qualityPenalty);
}

function needsRecovery(scored: ScoredExtraction): boolean {
  const fields = isRecord(scored.result.fields) ? Object.values(scored.result.fields).filter(isRecord) : [];
  const populatedCount = fields.filter(field => field.value !== null && field.value !== undefined && field.value !== "").length;
  return scored.score < 48 || populatedCount < 2 || scored.result.docType === "Unknown" || scored.result.imageQuality === "unreadable";
}

function logAttempt(originalname: string, attempt: ExtractionAttempt, validated: Record<string, unknown> | null, score?: number) {
  logger.info({
    file: originalname,
    strategy: attempt.strategy,
    responseLength: attempt.raw.length,
    finishReason: attempt.finishReason,
    promptTokens: attempt.promptTokens,
    completionTokens: attempt.completionTokens,
    parsed: Boolean(validated),
    score,
  }, "document extraction attempt");
}

async function evaluateAttempt(originalname: string, attempt: ExtractionAttempt): Promise<ScoredExtraction | null> {
  const parsed = parseExtraction(attempt.raw);
  const validated = parsed ? validateExtraction(parsed) : null;
  const score = validated ? scoreExtraction(validated) : undefined;
  logAttempt(originalname, attempt, validated, score);

  if (!validated) {
    logger.warn({
      file: originalname,
      strategy: attempt.strategy,
      finishReason: attempt.finishReason,
      responsePreview: attempt.raw.slice(0, 1000),
    }, "unrecognized document extraction response");
    return null;
  }

  return { result: validated, score: score ?? 0, strategy: attempt.strategy };
}

async function runImageExtraction(buffer: Buffer, mime: string, originalname: string): Promise<ScoredExtraction> {
  const primaryStrategy = ORIENTATION_STRATEGIES[0];
  const primaryAttempt = await extractFromImage(buffer, mime, primaryStrategy.name, primaryStrategy.instruction, false);
  const primary = await evaluateAttempt(originalname, primaryAttempt);

  if (primary && !needsRecovery(primary)) return primary;

  const candidates: ScoredExtraction[] = primary ? [primary] : [];
  const recoveryStrategies = primary
    ? ORIENTATION_STRATEGIES.slice(1)
    : ORIENTATION_STRATEGIES;

  for (const strategy of recoveryStrategies) {
    const attempt = await extractFromImage(buffer, mime, strategy.name, strategy.instruction, true);
    const candidate = await evaluateAttempt(originalname, attempt);
    if (candidate) candidates.push(candidate);

    if (candidate && candidate.score >= 78 && candidate.result.docType !== "Unknown") break;
  }

  if (!candidates.length) {
    throw new Error("The document processor returned an unrecognized response format after all recovery attempts.");
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  best.result.scanMeta = {
    selectedStrategy: best.strategy,
    extractionScore: Math.round(best.score),
    attemptsRun: candidates.length,
    recoveryUsed: candidates.length > 1,
  };
  return best;
}

async function runTextExtraction(text: string, originalname: string): Promise<ScoredExtraction> {
  const candidates: ScoredExtraction[] = [];
  for (let pass = 0; pass < 2; pass += 1) {
    const attempt = await extractFromText(text, pass === 1);
    const candidate = await evaluateAttempt(originalname, attempt);
    if (candidate) candidates.push(candidate);
    if (candidate && !needsRecovery(candidate)) break;
  }

  if (!candidates.length) {
    throw new Error("The document processor returned an unrecognized response format after PDF recovery attempts.");
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  best.result.scanMeta = {
    selectedStrategy: best.strategy,
    extractionScore: Math.round(best.score),
    attemptsRun: candidates.length,
    recoveryUsed: candidates.length > 1,
  };
  return best;
}

router.post("/scan-document", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ stage: "backend_receipt", error: "No file received. Please try again." });
    return;
  }

  const { buffer, originalname } = req.file;
  if (!buffer.length) {
    res.status(422).json({ stage: "file_validation", error: "The uploaded file is empty." });
    return;
  }

  let mime: string;
  try {
    mime = detectMime(buffer);
  } catch (err) {
    logger.error({ err }, "MIME detection failed");
    res.status(422).json({ stage: "mime_validation", error: "Could not read file. Please try a different file." });
    return;
  }

  if (mime === "application/octet-stream") {
    const ext = originalname.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "jpg" || ext === "jpeg") mime = "image/jpeg";
    else if (ext === "png") mime = "image/png";
    else if (ext === "gif") mime = "image/gif";
    else if (ext === "webp") mime = "image/webp";
    else if (ext === "heic" || ext === "heif") mime = "image/heic";
    else if (ext === "pdf") mime = "application/pdf";
  }

  const supported = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
  if (!supported.includes(mime)) {
    res.status(422).json({
      stage: "mime_validation",
      error: mime === "image/heic"
        ? "HEIC images are not currently decoded safely. Convert the image to JPG or PNG and retry."
        : `Unsupported file type (${mime}). Please upload JPG, PNG, WEBP, GIF, or PDF.`,
    });
    return;
  }

  try {
    let scored: ScoredExtraction;

    if (mime === "application/pdf") {
      let pdfText = "";
      try {
        const parsed = await pdfParse(buffer);
        pdfText = parsed.text;
      } catch (err) {
        logger.warn({ err, file: originalname }, "PDF text extraction failed");
      }

      if (pdfText.trim().length <= 100) {
        res.status(422).json({
          stage: "image_decode",
          error: "This PDF appears to be image-only with no embedded text. Upload screenshots of its pages as images for the any-angle scanner.",
        });
        return;
      }
      scored = await runTextExtraction(pdfText, originalname);
    } else {
      scored = await runImageExtraction(buffer, mime, originalname);
    }

    const result = scored.result;
    const rawInstitutionName =
      (isRecord(result.institution) && typeof result.institution.rawName === "string"
        ? result.institution.rawName
        : null) ??
      (isRecord(result.fields) && isRecord(result.fields.institution) && typeof result.fields.institution.value === "string"
        ? result.fields.institution.value
        : null);
    const institution = normalizeInstitution(rawInstitutionName);

    logger.info({
      docType: result.docType,
      file: originalname,
      institution: institution.normalizedName,
      strategy: scored.strategy,
      score: scored.score,
      orientation: result.detectedOrientation,
      quality: result.imageQuality,
    }, "scan complete");

    res.json({ ...result, institution, fileName: originalname, mimeType: mime });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Document analysis failed.";
    logger.error({ err, file: originalname }, "scan failed");
    res.status(500).json({
      stage: message.includes("unrecognized response") ? "response_validation" : "ai_request",
      error: message.includes("unrecognized response")
        ? message
        : "Document analysis failed after multiple recovery attempts. Please try again.",
    });
  }
});

export default router;
