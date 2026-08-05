import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { taxScenariosTable } from "@workspace/db/schema";

/**
 * Returns only the latest saved tax-estimator output for the authenticated user.
 * The full input payload is intentionally excluded so the AI receives a compact,
 * deterministic result instead of a large duplicate of the user's profile.
 */
export async function getLatestTaxEstimateForAI(userId: string) {
  const [scenario] = await db
    .select({
      id: taxScenariosTable.id,
      name: taxScenariosTable.name,
      taxYear: taxScenariosTable.taxYear,
      result: taxScenariosTable.result,
      updatedAt: taxScenariosTable.updatedAt,
    })
    .from(taxScenariosTable)
    .where(and(eq(taxScenariosTable.userId, userId), isNull(taxScenariosTable.deletedAt)))
    .orderBy(desc(taxScenariosTable.updatedAt))
    .limit(1);

  if (!scenario) return null;

  const result = (scenario.result ?? {}) as Record<string, unknown>;
  const numberOrNull = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    taxYear: scenario.taxYear,
    updatedAt: scenario.updatedAt,
    totalGrossIncome: numberOrNull(result.totalGrossIncome),
    adjustedGrossIncome: numberOrNull(result.adjustedGrossIncome),
    federalIncomeTax: numberOrNull(result.federalIncomeTax),
    stateIncomeTax: numberOrNull(result.stateIncomeTax),
    payrollTaxes: [
      numberOrNull(result.socialSecurityTax),
      numberOrNull(result.medicareTax),
      numberOrNull(result.additionalMedicareTax),
      numberOrNull(result.seTax),
    ].reduce<number>((sum, value) => sum + (value ?? 0), 0),
    totalEstimatedTax: numberOrNull(result.totalEstimatedTax),
    estimatedRefundOrOwed: numberOrNull(result.estimatedRefundOrOwed),
    effectiveTaxRate: numberOrNull(result.effectiveTaxRate),
    confidenceLevel: typeof result.confidenceLevel === "string" ? result.confidenceLevel : null,
    confidenceScore: numberOrNull(result.confidenceScore),
  };
}
