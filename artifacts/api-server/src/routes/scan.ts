import { Router, type IRouter } from "express";
import multer from "multer";
import OpenAI from "openai";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
// pdf-parse v1 is CJS; use createRequire to avoid ESM default-export issue
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = _require("pdf-parse");
import { logger } from "../lib/logger.js";
import { normalizeInstitution } from "../lib/institution-registry.js";

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

const SYSTEM_PROMPT = `You are a financial document extraction AI. Analyze the document and respond with ONLY valid JSON (no markdown, no code fences, no explanation).

STEP 1 — Classify docType as exactly one of:
Paystub |
Checking Account | Savings Account | High-Yield Savings | Money Market Account | Certificate of Deposit | Cash Management Account | Bank Statement |
Credit Card | Credit Card Statement | Line of Credit |
Auto Loan | Personal Loan | Mortgage | HELOC | Student Loan |
Brokerage Account | Margin Account | Robo-Adviser Account | Employee Stock Plan |
401(k) | Roth 401(k) | 403(b) | 457(b) | Traditional IRA | Roth IRA | SEP IRA | SIMPLE IRA | Rollover IRA | Pension | Thrift Savings Plan | HSA Investment Account |
Monthly Bill | Utility Bill | Unknown

STEP 2 — Extract the institution. Look for bank name, brokerage name, plan administrator, servicer, employer plan sponsor, or credit union name. Capture the name exactly as printed. ANY institution name is valid including unknown ones — never reject for an unrecognized provider.

STEP 3 — Extract document fields. Return ONLY fields clearly visible. Set unclear fields to null.

CRITICAL RULES:
- Never invent, estimate, or calculate. If not visible → null.
- Confidence 90-100: clearly shown. 60-89: likely correct. Below 60 → null.
- Numbers: plain number only (no $, commas, %). Dates: YYYY-MM-DD. Percentages: number (5.5 not "5.5%").
- Do NOT confuse: employee contributions vs employer match | account value vs vested balance | buying power vs cash | 401(k) loan vs retirement balance | Roth 401(k) vs Roth IRA | brokerage cash vs checking cash.
- Preserve any labeled field not in the list below in unknownFields.

Respond with this exact shape:
{
  "docType": "401(k)",
  "classificationConfidence": 92,
  "institution": {
    "rawName": "Fidelity NetBenefits",
    "isKnownInstitution": true
  },
  "fields": {
    "currentBalance": { "value": 48216.83, "confidence": 95, "sourceText": "Total Account Value $48,216.83" },
    "employeeContributionRate": { "value": 6, "confidence": 88, "sourceText": "Your Contribution 6%" }
  },
  "unknownFields": [
    { "label": "Vested Balance", "value": 38000.00, "confidence": 90 }
  ]
}

Fields to extract by document type:

PAYSTUB: employer, payDate, payPeriodStart, payPeriodEnd, hourlyRate, regularHours, overtimeHours, doubleTimeHours, perDiem, standbyPay, bonus, grossPay, federalTax, stateTax, socialSecurity, medicare, unionDues, insuranceDeductions, retirementContribution, retirementRate, otherDeductions, netPay

CHECKING ACCOUNT / CASH MANAGEMENT ACCOUNT: institution, accountType, accountName, lastFour, currentBalance, availableBalance, pendingBalance, apy, interestEarned, statementDate, accountStatus

SAVINGS ACCOUNT / HIGH-YIELD SAVINGS / MONEY MARKET ACCOUNT: institution, accountType, accountName, lastFour, currentBalance, availableBalance, apy, interestEarned, statementDate

CERTIFICATE OF DEPOSIT: institution, accountName, lastFour, currentBalance, apy, maturityDate, termMonths, interestEarned, penaltyForEarlyWithdrawal

BANK STATEMENT: institution, accountType, accountName, lastFour, statementStartDate, statementEndDate, openingBalance, closingBalance, totalDeposits, totalWithdrawals

CREDIT CARD / CREDIT CARD STATEMENT: issuer, accountName, lastFour, currentBalance, statementBalance, creditLimit, availableCredit, apr, minimumPayment, dueDate, autopay

LINE OF CREDIT: lender, accountName, lastFour, creditLimit, currentBalance, availableCredit, apr, minimumPayment, dueDate

AUTO LOAN / PERSONAL LOAN / SECURED LOAN: lender, loanName, lastFour, currentBalance, originalAmount, apr, monthlyPayment, remainingTermMonths, originalTermMonths, nextDueDate, payoffAmount

MORTGAGE: lender, propertyAddress, principalBalance, originalLoanAmount, interestRate, monthlyPayment, principalAndInterest, escrowAmount, nextDueDate, remainingTermMonths, propertyValue

HELOC: lender, creditLimit, currentBalance, availableCredit, interestRate, monthlyPayment, drawPeriodEnd, repaymentPeriodMonths

STUDENT LOAN: servicer, loanType, lastFour, currentBalance, originalAmount, interestRate, monthlyPayment, remainingTermMonths, nextDueDate, repaymentPlan

BROKERAGE ACCOUNT / ROBO-ADVISER ACCOUNT: institution, accountType, lastFour, totalValue, securitiesValue, cashBalance, buyingPower, marginBalance, marginAvailable, marginInterestRate, dayChange, totalReturn, unrealizedGain, realizedGain, statementDate

MARGIN ACCOUNT: institution, accountType, lastFour, totalValue, securitiesValue, cashBalance, marginBalance, marginAvailable, marginInterestRate, buyingPower, unrealizedGain, statementDate

EMPLOYEE STOCK PLAN: institution, employer, planType, totalValue, vestedValue, unvestedValue, sharesVested, sharesUnvested, grantDate, vestingSchedule, statementDate

401(k) / ROTH 401(k) / 403(b) / 457(b) / THRIFT SAVINGS PLAN: institution, employer, planName, planType, lastFour, currentBalance, vestedBalance, employeeContributionRate, rothContributionRate, pretaxContributionRate, employeeYtdContributions, employerYtdContributions, employerMatchFormula, employerMatchAmount, vestingPercent, vestingSchedule, outstandingLoanBalance, loanPayment, statementDate

TRADITIONAL IRA / ROTH IRA / SEP IRA / SIMPLE IRA / ROLLOVER IRA: institution, accountType, lastFour, currentBalance, ytdContributions, contributionLimit, statementDate

PENSION: institution, employer, planName, monthlyBenefit, vestedBenefit, retirementAge, yearsOfService, statementDate

HSA INVESTMENT ACCOUNT: institution, currentBalance, investedBalance, cashBalance, ytdContributions, contributionLimit, statementDate

MONTHLY BILL / UTILITY BILL: provider, category, amountDue, dueDate, billingFrequency, billingPeriod, recurringFrequency, autopay, lastFour

If the document contains multiple unrelated financial documents, set docType to "Multiple Documents" and fields to {}.`;

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

// Route registered at POST /api/scan-document (via app.use("/api", router))
router.post("/scan-document", upload.single("file"), async (req, res) => {
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

    // Normalize institution name server-side against the registry.
    // Works for any institution — unknown ones pass through with isKnownInstitution=false.
    const rawInstitutionName =
      (result.institution as any)?.rawName ??
      (result.fields as any)?.institution?.value ??
      null;
    const institution = normalizeInstitution(rawInstitutionName as string | null);

    logger.info({ docType: result.docType, file: originalname, institution: institution.normalizedName }, "scan complete");
    res.json({ ...result, institution, fileName: originalname, mimeType: mime });
  } catch (err) {
    logger.error({ err }, "scan failed");
    res.status(500).json({
      stage: "ai_request",
      error: "Document analysis failed. Please try again.",
    });
  }
});

export default router;
