/**
 * Tax rules version router.
 *
 * To add a new tax year:
 *   1. Create tax-rules/<year>.ts modelling TaxYearRules.
 *   2. Add a case to getTaxRules() below.
 *   3. Update the DEFAULT_TAX_YEAR constant.
 *
 * All UI code should call getTaxRules(year) rather than importing a year
 * file directly, so switching years requires only this dispatcher update.
 */

export type { FilingStatus, TaxBracket, IRAPhaseout, TaxYearRules } from './2026';
export { TAX_RULES_2026 } from './2026';

import { TAX_RULES_2026, type TaxYearRules } from './2026';

export const DEFAULT_TAX_YEAR = 2026;

export function getTaxRules(year: number): TaxYearRules {
  switch (year) {
    case 2026: return TAX_RULES_2026;
    default:
      throw new Error(
        `Tax rules for ${year} are not yet available. Supported years: 2026.`,
      );
  }
}
