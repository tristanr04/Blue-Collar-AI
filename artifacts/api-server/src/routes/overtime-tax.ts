import { Router, type IRouter } from "express";
import { calculateOvertimeTax, type FilingStatus, type FLSAStatus, type OvertimeEntry } from "../lib/overtime-tax.js";

const router: IRouter = Router();
const filingStatuses = new Set<FilingStatus>(["single", "married_filing_jointly", "married_filing_separately", "head_of_household"]);
const flsaStatuses = new Set<FLSAStatus>(["confirmed_eligible", "confirmed_ineligible", "needs_confirmation"]);

function finiteNumber(value: unknown, field: string, required = true): number | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative number.`);
  return value;
}

function parseEntry(value: unknown, index: number): OvertimeEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`entries[${index}] must be an object.`);
  const row = value as Record<string, unknown>;
  if (!flsaStatuses.has(row.flsaStatus as FLSAStatus)) throw new Error(`entries[${index}].flsaStatus is invalid.`);
  const source = row.source;
  if (source !== undefined && !["paystub", "w2_code_tt", "1099", "manual"].includes(String(source))) {
    throw new Error(`entries[${index}].source is invalid.`);
  }
  return {
    regularRate: finiteNumber(row.regularRate, `entries[${index}].regularRate`)! ,
    overtimeHours: finiteNumber(row.overtimeHours, `entries[${index}].overtimeHours`)! ,
    overtimeRate: finiteNumber(row.overtimeRate, `entries[${index}].overtimeRate`, false),
    overtimePay: finiteNumber(row.overtimePay, `entries[${index}].overtimePay`, false),
    doubleTimeHours: finiteNumber(row.doubleTimeHours, `entries[${index}].doubleTimeHours`, false),
    doubleTimeRate: finiteNumber(row.doubleTimeRate, `entries[${index}].doubleTimeRate`, false),
    doubleTimePay: finiteNumber(row.doubleTimePay, `entries[${index}].doubleTimePay`, false),
    hoursWorkedInWorkweek: finiteNumber(row.hoursWorkedInWorkweek, `entries[${index}].hoursWorkedInWorkweek`, false),
    reportedQualifiedOvertime: finiteNumber(row.reportedQualifiedOvertime, `entries[${index}].reportedQualifiedOvertime`, false),
    flsaStatus: row.flsaStatus as FLSAStatus,
    source: source as OvertimeEntry["source"],
  };
}

router.post("/tax/overtime/calculate", (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const taxYear = finiteNumber(body.taxYear, "taxYear")!;
    if (!Number.isInteger(taxYear) || taxYear < 2020 || taxYear > 2100) throw new Error("taxYear must be a valid four-digit year.");
    if (!filingStatuses.has(body.filingStatus as FilingStatus)) throw new Error("filingStatus is invalid.");
    if (!Array.isArray(body.entries) || body.entries.length === 0) throw new Error("entries must contain at least one overtime record.");
    if (body.entries.length > 500) throw new Error("entries cannot exceed 500 records per calculation.");

    const result = calculateOvertimeTax({
      taxYear,
      filingStatus: body.filingStatus as FilingStatus,
      modifiedAdjustedGrossIncome: finiteNumber(body.modifiedAdjustedGrossIncome, "modifiedAdjustedGrossIncome")!,
      hasValidEmploymentSSN: body.hasValidEmploymentSSN === undefined ? undefined : Boolean(body.hasValidEmploymentSSN),
      entries: body.entries.map(parseEntry),
    });

    res.json({ result, informationalOnly: true });
  } catch (error) {
    res.status(400).json({
      stage: "overtime_tax_validation",
      error: error instanceof Error ? error.message : "Invalid overtime tax calculation request.",
    });
  }
});

export default router;
