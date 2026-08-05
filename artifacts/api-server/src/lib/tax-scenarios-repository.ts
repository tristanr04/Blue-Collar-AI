/**
 * Tax Scenarios repository.
 *
 * All mutations are soft-delete friendly: `deletedAt IS NULL` guards all reads.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { taxScenariosTable } from "@workspace/db/schema";
import { logger } from "./logger.js";

export interface TaxScenarioRow {
  id: string;
  userId: string;
  name: string;
  taxYear: number;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaxScenarioInput {
  name: string;
  taxYear: number;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
}

/** List all active (non-deleted) tax scenarios for the given user. */
export async function listTaxScenarios(userId: string): Promise<TaxScenarioRow[]> {
  const rows = await db
    .select()
    .from(taxScenariosTable)
    .where(and(eq(taxScenariosTable.userId, userId), isNull(taxScenariosTable.deletedAt)))
    .orderBy(taxScenariosTable.updatedAt);

  return rows.map(mapRow);
}

/** Create a new tax scenario for the given user. */
export async function createTaxScenario(
  userId: string,
  data: TaxScenarioInput,
): Promise<TaxScenarioRow> {
  const [row] = await db
    .insert(taxScenariosTable)
    .values({
      userId,
      name: data.name,
      taxYear: data.taxYear,
      inputs: data.inputs,
      result: data.result,
    })
    .returning();

  if (!row) throw new Error("Tax scenario insert returned no row.");
  return mapRow(row);
}

/** Update name/inputs/result for a scenario owned by the given user. */
export async function updateTaxScenario(
  userId: string,
  id: string,
  data: Partial<TaxScenarioInput>,
): Promise<TaxScenarioRow> {
  const [row] = await db
    .update(taxScenariosTable)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.inputs !== undefined && { inputs: data.inputs }),
      ...(data.result !== undefined && { result: data.result }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(taxScenariosTable.id, id),
        eq(taxScenariosTable.userId, userId),
        isNull(taxScenariosTable.deletedAt),
      ),
    )
    .returning();

  if (!row) {
    logger.warn({ userId, id }, "tax_scenario_update_not_found");
    throw new Error("Scenario not found or access denied.");
  }
  return mapRow(row);
}

/** Soft-delete a tax scenario owned by the given user. */
export async function softDeleteTaxScenario(userId: string, id: string): Promise<void> {
  const result = await db
    .update(taxScenariosTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(taxScenariosTable.id, id),
        eq(taxScenariosTable.userId, userId),
        isNull(taxScenariosTable.deletedAt),
      ),
    );

  if (!result.rowCount) {
    logger.warn({ userId, id }, "tax_scenario_delete_not_found");
  }
}

function mapRow(row: typeof taxScenariosTable.$inferSelect): TaxScenarioRow {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    taxYear: row.taxYear,
    inputs: (row.inputs as Record<string, unknown>) ?? {},
    result: (row.result as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
