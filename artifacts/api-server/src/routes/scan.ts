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
  limits: { fileSize: 20 * 1024 * 1024 },
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

const SYSTEM_PROMPT = `You are a financial document extraction AI. Analyze the document and respond with exactly one valid JSON object. Do not use markdown, code fences, commentary, or multiple objects.

Classify docType as exactly one of:
Paystub | Checking Account | Savings Account | High-Yield Savings | Money Market Account | Certificate of Deposit | Cash Management Account | Bank Statement | Credit Card | Credit Card Statement | Line of Credit | Auto Loan | Personal Loan | Mortgage | HELOC | Student Loan | Brokerage Account | Margin Account | Robo-Adviser Account | Employee Stock Plan | 401(k) | Roth 401(k) | 403(b) | 457(b) | Traditional IRA | Roth IRA | SEP IRA | SIMPLE IRA | Rollover IRA | Pension | Thrift Savings Plan | HSA Investment Account | Monthly Bill | Utility Bill | Unknown

Extract the institution exactly as printed. Unknown institutions are valid.
Return only fields clearly visible. Never estimate or calculate. Use plain numbers without currency symbols, commas, or percent signs. Dates must be YYYY-MM-DD. Set unclear values to null.

Return this shape:
{
  "docType": "Credit Card Statement",
  "classificationConfidence": 95,
  "institution": { "rawName": "Example Bank", "isKnownInstitution": false },
  "fields": {
    "currentBalance": { "value": 1200.25, "confidence": 95, "sourceText": "Current Balance $1,200.25" }
  },
  "unknownFields": []
}

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
};

async function extractFromImage(buffer: Buffer, mimeType: string, retry = false): Promise<ExtractionAttempt> {
  const b64 = buffer.toString("base64");
  const response = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    max_completion_tokens: retry ? 3072 : 2048,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: retry
              ? "The previous extraction was malformed. Re-analyze this document and return exactly one complete valid JSON object using the required schema."
              : "Extract all visible financial data from this document and return exactly one complete JSON object.",
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
  };
}

async function extractFromText(text: string, pageHint?: string, retry = false): Promise<ExtractionAttempt> {
  const response = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    max_completion_tokens: retry ? 3072 : 2048,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `${retry ? "The previous extraction was malformed. " : ""}Extract all visible financial data from this document text${pageHint ? ` (${pageHint})` : ""} and return exactly one complete JSON object:\n\n${text.slice(0, 12000)}`,
      },
    ],
  });
  return {
    raw: response.choices[0]?.message?.content ?? "",
    finishReason: response.choices[0]?.finish_reason ?? null,
    promptTokens: response.usage?.prompt_tokens,
    completionTokens: response.usage?.completion_tokens,
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
    const variants = [
      candidate,
      candidate.replace(/,\s*([}\]])/g, "$1"),
    ];
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

function validateExtraction(result: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof result.docType !== "string" || !result.docType.trim()) return null;
  if (!isRecord(result.fields)) result.fields = {};
  if (typeof result.classificationConfidence !== "number") result.classificationConfidence = 0;
  return result;
}

async function runExtraction(
  buffer: Buffer,
  mime: string,
  originalname: string,
  pdfText?: string,
): Promise<Record<string, unknown>> {
  for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
    const retry = attemptNumber === 2;
    const attempt = pdfText !== undefined
      ? await extractFromText(pdfText, "PDF", retry)
      : await extractFromImage(buffer, mime, retry);

    const parsed = parseExtraction(attempt.raw);
    const validated = parsed ? validateExtraction(parsed) : null;

    logger.info({
      file: originalname,
      attempt: attemptNumber,
      responseLength: attempt.raw.length,
      finishReason: attempt.finishReason,
      promptTokens: attempt.promptTokens,
      completionTokens: attempt.completionTokens,
      parsed: Boolean(validated),
    }, "document extraction attempt");

    if (validated) return validated;

    logger.warn({
      file: originalname,
      attempt: attemptNumber,
      finishReason: attempt.finishReason,
      responsePreview: attempt.raw.slice(0, 1000),
    }, "unrecognized document extraction response");
  }

  throw new Error("The document processor returned an unrecognized response format after two attempts.");
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
    let result: Record<string, unknown>;

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
          error: "This PDF appears to be image-only with no embedded text. Screenshot individual pages and upload them as images.",
        });
        return;
      }
      result = await runExtraction(buffer, mime, originalname, pdfText);
    } else {
      result = await runExtraction(buffer, mime, originalname);
    }

    const rawInstitutionName =
      (isRecord(result.institution) && typeof result.institution.rawName === "string"
        ? result.institution.rawName
        : null) ??
      (isRecord(result.fields) && isRecord(result.fields.institution) && typeof result.fields.institution.value === "string"
        ? result.fields.institution.value
        : null);
    const institution = normalizeInstitution(rawInstitutionName);

    logger.info({ docType: result.docType, file: originalname, institution: institution.normalizedName }, "scan complete");
    res.json({ ...result, institution, fileName: originalname, mimeType: mime });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Document analysis failed.";
    logger.error({ err, file: originalname }, "scan failed");
    res.status(500).json({
      stage: message.includes("unrecognized response") ? "response_validation" : "ai_request",
      error: message.includes("unrecognized response")
        ? message
        : "Document analysis failed. Please try again.",
    });
  }
});

export default router;
