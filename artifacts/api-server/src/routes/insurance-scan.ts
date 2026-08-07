import { Router, type IRouter } from "express";
import multer from "multer";
import OpenAI from "openai";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

const INSURANCE_PROMPT = `You are an insurance-document extraction system for difficult real-world photos and scans. Inspect the document at 0, 90, 180, and 270 degrees. Handle blur, glare, low contrast, perspective skew, cropping, wrinkles, screenshots, tiny print, and partial obstruction. Never guess missing values.

Return exactly one JSON object with no markdown.

Classify docType as exactly one of:
Auto Insurance Card | Auto Insurance Declarations | Homeowners Insurance Declarations | Renters Insurance Declarations | Health Insurance Card | Health Plan Summary | Explanation of Benefits | Medical Bill | Dental Insurance | Vision Insurance | Life Insurance Policy | Disability Insurance Policy | Workers Compensation Document | Umbrella Insurance Policy | Insurance Premium Notice | Insurance Renewal Notice | Insurance Cancellation Notice | Insurance Claim Document | Insurance Estimate | Insurance Policy | Unknown Insurance Document

Return this shape:
{
  "docType": "Auto Insurance Declarations",
  "classificationConfidence": 95,
  "detectedOrientation": 0,
  "imageQuality": "good",
  "qualityWarnings": [],
  "carrier": { "rawName": "Example Insurance", "confidence": 95 },
  "fields": {
    "policyNumber": { "value": "ABC123", "confidence": 95, "sourceText": "Policy Number ABC123" }
  },
  "unknownFields": []
}

imageQuality: excellent | good | fair | poor | unreadable.
detectedOrientation: 0 | 90 | 180 | 270.

Extract only clearly visible fields relevant to the document:
COMMON: carrier, policyNumber, groupNumber, memberId, subscriberName, insuredNames, policyType, effectiveDate, expirationDate, issueDate, renewalDate, cancellationDate, premium, monthlyPremium, annualPremium, paymentFrequency, amountDue, dueDate, agentName, agentPhone, claimsPhone, website, mailingAddress
AUTO: vehicleYear, vehicleMake, vehicleModel, vin, drivers, bodilyInjuryPerPerson, bodilyInjuryPerAccident, propertyDamageLimit, uninsuredMotoristLimit, underinsuredMotoristLimit, medicalPaymentsLimit, personalInjuryProtectionLimit, comprehensiveDeductible, collisionDeductible, rentalCoverage, roadsideCoverage, lienholder
HOME_RENTERS: propertyAddress, dwellingLimit, otherStructuresLimit, personalPropertyLimit, lossOfUseLimit, personalLiabilityLimit, medicalPaymentsLimit, windHailDeductible, allOtherPerilsDeductible, replacementCost, mortgagee
HEALTH: planName, planType, networkName, rxBin, rxPcn, rxGroup, primaryCareCopay, specialistCopay, urgentCareCopay, emergencyRoomCopay, individualDeductible, familyDeductible, individualOutOfPocketMax, familyOutOfPocketMax, coinsurance, customerServicePhone, providerPhone, pharmacyPhone
EOB_MEDICAL: patientName, providerName, serviceDate, claimNumber, billedAmount, allowedAmount, planPaid, patientResponsibility, deductibleApplied, copayApplied, coinsuranceApplied, denialReason, remarkCodes, appealDeadline
LIFE_DISABILITY: insuredName, ownerName, beneficiary, faceAmount, benefitAmount, eliminationPeriod, benefitPeriod, cashValue, surrenderValue, premiumClass, riderNames
CLAIM: claimNumber, dateOfLoss, lossType, adjusterName, adjusterPhone, estimateAmount, deductible, paymentAmount, status

Use strings for identifiers to preserve leading zeros. Use plain numbers for money and percentages. Dates must be YYYY-MM-DD when fully visible; otherwise preserve the printed date as sourceText and set value to null.`;

function detectMime(buffer: Buffer): string {
  const h = buffer.subarray(0, 16);
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return "image/jpeg";
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return "image/png";
  if (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46) return "image/gif";
  if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46) return "image/webp";
  return "application/octet-stream";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function score(result: Record<string, unknown>): number {
  const fields = isRecord(result.fields) ? Object.values(result.fields).filter(isRecord) : [];
  const populated = fields.filter((field) => field.value !== null && field.value !== undefined && field.value !== "");
  const confidence = typeof result.classificationConfidence === "number" ? result.classificationConfidence : 0;
  return populated.length * 5 + Math.min(25, confidence * 0.25) + (result.docType !== "Unknown Insurance Document" ? 15 : 0);
}

async function attempt(buffer: Buffer, mime: string, instruction: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    max_completion_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: INSURANCE_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: instruction },
          { type: "image_url", image_url: { url: `data:${mime};base64,${buffer.toString("base64")}`, detail: "high" } },
        ],
      },
    ],
  });
  const raw = response.choices[0]?.message?.content ?? "";
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error("Invalid insurance extraction response.");
  return { result: parsed, usage: response.usage };
}

router.post("/scan-insurance-document", upload.single("file"), async (req, res) => {
  if (!req.file?.buffer.length) {
    res.status(400).json({ error: "No insurance document received." });
    return;
  }

  let mime = detectMime(req.file.buffer);
  if (mime === "application/octet-stream") {
    const ext = req.file.originalname.split(".").pop()?.toLowerCase();
    if (ext === "jpg" || ext === "jpeg") mime = "image/jpeg";
    else if (ext === "png") mime = "image/png";
    else if (ext === "gif") mime = "image/gif";
    else if (ext === "webp") mime = "image/webp";
  }
  if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime)) {
    res.status(422).json({ error: "Upload the insurance document as JPG, PNG, GIF, or WEBP." });
    return;
  }

  try {
    const attempts = [] as Array<{ result: Record<string, unknown>; usage: unknown; strategy: string; score: number }>;
    for (const strategy of [
      "Inspect normally and verify all rotations.",
      "Recovery pass: treat the document as possibly sideways or upside down; inspect tiny print, tables, and card fields carefully.",
    ]) {
      try {
        const extracted = await attempt(req.file.buffer, mime, strategy);
        attempts.push({ ...extracted, strategy, score: score(extracted.result) });
        if (attempts.at(-1)!.score >= 70) break;
      } catch (err) {
        logger.warn({ err, file: req.file.originalname, strategy }, "insurance extraction attempt failed");
      }
    }
    if (!attempts.length) throw new Error("Insurance document could not be extracted.");
    attempts.sort((a, b) => b.score - a.score);
    const best = attempts[0];
    res.json({
      ...best.result,
      fileName: req.file.originalname,
      mimeType: mime,
      scanMeta: { extractionScore: Math.round(best.score), attemptsRun: attempts.length, recoveryUsed: attempts.length > 1 },
    });
  } catch (err) {
    logger.error({ err, file: req.file.originalname }, "insurance scan failed");
    res.status(500).json({ error: "Insurance document analysis failed. Please try a clearer photo or another angle." });
  }
});

export default router;
