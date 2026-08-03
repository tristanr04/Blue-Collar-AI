import { Router, type IRouter } from "express";
import multer from "multer";
import OpenAI from "openai";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
// pdf-parse v1 is CJS; use createRequire to avoid ESM default-export issue
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = _require("pdf-parse");
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

// ─── MIME detection from magic bytes ─────────────────────────────────────────

function detectMime(buffer: Buffer): string {
  const h = buffer.subarray(0, 16);
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return "image/jpeg";
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return "image/png";
  if (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46) return "image/gif";
  if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46) return "image/webp";
  if (h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) return "application/pdf";
  // HEIC/HEIF: ftyp box at offset 4
  if (buffer.length > 12) {
    const ftyp = buffer.subarray(4, 8).toString("ascii");
    if (ftyp === "ftyp") return "image/heic";
  }
  return "application/octet-stream";
}

// ─── Extraction prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a financial document extraction AI for a blue-collar worker finance app.

Analyze this financial document and respond with ONLY valid JSON (no markdown, no code fences, no explanation).

STEP 1 — Classify as exactly one of:
Paystub | Checking Account | Savings Account | Bank Statement | Credit Card | Credit Card Statement | Auto Loan | Personal Loan | Mortgage | Brokerage Account | Investment Statement | Retirement Account | Retirement Statement | Monthly Bill | Utility Bill | Unknown

STEP 2 — Extract fields. Return ONLY fields clearly visible in the document. Set any unclear field to null.

CRITICAL RULES:
- Never invent, estimate, or calculate. If not visible → null.
- Confidence 90-100: clearly shown. 60-89: likely correct. Below 60 → null instead.
- Numbers: return as plain number (no $, commas, %). Dates as YYYY-MM-DD. Percentages as number (e.g. 5.5 not "5.5%").

Respond with exactly this shape:
{
  "docType": "Paystub",
  "classificationConfidence": 92,
  "fields": {
    "employer": { "value": "Acme Corp", "confidence": 95, "sourceText": "ACME CORP" },
    "netPay": { "value": 1420.50, "confidence": 88, "sourceText": "Net Pay $1,420.50" }
  }
}

Fields to extract by document type:

PAYSTUB: employer, payDate, payPeriodStart, payPeriodEnd, hourlyRate, regularHours, overtimeHours, doubleTimeHours, perDiem, standbyPay, bonus, grossPay, federalTax, stateTax, socialSecurity, medicare, unionDues, insuranceDeductions, retirementContribution, retirementRate, otherDeductions, netPay

CHECKING ACCOUNT / SAVINGS ACCOUNT: institution, accountType, accountName, lastFour, currentBalance, availableBalance, apy, statementDate

BANK STATEMENT: institution, accountType, accountName, lastFour, statementStartDate, statementEndDate, openingBalance, closingBalance, totalDeposits, totalWithdrawals

CREDIT CARD: issuer, accountName, lastFour, currentBalance, statementBalance, creditLimit, availableCredit, apr, minimumPayment, dueDate, autopay

CREDIT CARD STATEMENT: issuer, accountName, lastFour, statementDate, openingBalance, closingBalance, creditLimit, apr, minimumPayment, dueDate, totalCharges, totalPayments, totalFees

AUTO LOAN / PERSONAL LOAN: lender, loanName, lastFour, currentBalance, originalAmount, apr, monthlyPayment, remainingTermMonths, originalTermMonths, nextDueDate, payoffAmount

MORTGAGE: lender, propertyAddress, principalBalance, originalLoanAmount, interestRate, monthlyPayment, principalAndInterest, escrowAmount, nextDueDate, remainingTermMonths, propertyValue

BROKERAGE ACCOUNT: institution, accountType, totalValue, cashBalance, buyingPower, marginUsed, dailyReturn, totalReturn

RETIREMENT ACCOUNT / RETIREMENT STATEMENT: institution, accountType, currentBalance, employeeContributionRate, employeeContributions, employerMatch, employerMatchRate, ytdContributions, vestingPercent

MONTHLY BILL / UTILITY BILL: provider, category, amountDue, dueDate, billingFrequency, autopay, lastFour

If the image contains multiple unrelated financial documents, set docType to "Multiple Documents" and fields to {}.`;

// ─── Build messages for GPT ───────────────────────────────────────────────────

async function extractFromImage(buffer: Buffer, mimeType: string) {
  const b64 = buffer.toString("base64");
  const imgMime = mimeType === "image/heic" ? "image/jpeg" : mimeType;
  const response = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    max_completion_tokens: 2048,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract all financial data from this document." },
          { type: "image_url", image_url: { url: `data:${imgMime};base64,${b64}`, detail: "high" } },
        ],
      },
    ],
  });
  return response.choices[0]?.message?.content ?? "{}";
}

async function extractFromText(text: string, pageHint?: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    max_completion_tokens: 2048,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Extract all financial data from this document text${pageHint ? ` (${pageHint})` : ""}:\n\n${text.slice(0, 8000)}` },
    ],
  });
  return response.choices[0]?.message?.content ?? "{}";
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return { docType: "Unknown", classificationConfidence: 0, fields: {}, parseError: true };
  }
}

// ─── POST /api/scan ───────────────────────────────────────────────────────────

router.post("/scan", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ stage: "backend_receipt", error: "No file received. Please try again." });
    return;
  }

  const { buffer, originalname } = req.file;

  // Detect MIME from magic bytes — ignore whatever the browser reported
  let mime: string;
  try {
    mime = detectMime(buffer);
  } catch (err) {
    logger.error({ err }, "MIME detection failed");
    res.status(422).json({ stage: "mime_validation", error: "Could not read file. Please try a different file." });
    return;
  }

  // Normalize .jpg/.jpeg → image/jpeg when magic-byte detection falls back to
  // octet-stream (can happen with some iOS-generated JPEGs that omit the SOI marker)
  if (mime === "application/octet-stream") {
    const ext = originalname.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "jpg" || ext === "jpeg") mime = "image/jpeg";
    else if (ext === "png") mime = "image/png";
    else if (ext === "heic" || ext === "heif") mime = "image/heic";
    else if (ext === "pdf") mime = "application/pdf";
  }

  const supported = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "application/pdf"];
  if (!supported.includes(mime)) {
    res.status(422).json({
      stage: "mime_validation",
      error: `Unsupported file type (${mime}). Please upload JPG, PNG, HEIC, or PDF.`,
    });
    return;
  }

  try {
    let rawJson: string;

    if (mime === "application/pdf") {
      let pdfText = "";
      try {
        const parsed = await pdfParse(buffer);
        pdfText = parsed.text;
      } catch {
        pdfText = "";
      }

      if (pdfText.trim().length > 100) {
        rawJson = await extractFromText(pdfText, "PDF");
      } else {
        res.status(422).json({
          stage: "image_decode",
          error: "This PDF appears to be image-only with no embedded text. Screenshot individual pages and upload as images.",
        });
        return;
      }
    } else {
      rawJson = await extractFromImage(buffer, mime);
    }

    const result = safeParseJson(rawJson);
    logger.info({ docType: result.docType, file: originalname }, "scan complete");
    res.json({ ...result, fileName: originalname, mimeType: mime });
  } catch (err) {
    logger.error({ err }, "scan failed");
    res.status(500).json({
      stage: "ai_request",
      error: "Document analysis failed. Please try again.",
    });
  }
});

export default router;
