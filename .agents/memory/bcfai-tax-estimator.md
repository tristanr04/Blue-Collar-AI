---
name: BCFAI Tax Estimator
description: Architecture decisions and gotchas for the 2026 Tax Estimator feature.
---

## Rule
Tax rules are year-scoped: `tax-rules/2026.ts` holds constants as a `TaxYearRules` object whose year-identifier field is `year` (not `taxYear`). The dispatcher `getTaxRules(year)` in `tax-rules/index.ts` selects the right file. Adding a new tax year = new file + one dispatcher entry.

**Why:** Prevents the common mistake of scattering year-specific magic numbers across the codebase; future tax-year changes need no engine edits.

**How to apply:** Always access rules via `getTaxRules(year)` and reference `rules.year`, not a hardcoded literal or a non-existent `.taxYear` property.

## Rule
After any schema change to `lib/db/src/schema/financial.ts`, run `cd lib/db && npx tsc -p tsconfig.json` to regenerate the `dist/` declaration files before typechecking dependent packages (api-server, etc.).

**Why:** The api-server tsconfig uses project references; it reads `lib/db/dist/*.d.ts`, not the source. Stale dist causes "no exported member" errors that look like missing exports but are just outdated build artefacts.

**How to apply:** Any time api-server shows `Module '"@workspace/db/schema"' has no exported member '<name>'`, rebuild lib/db first.

## Architecture summary
- `tax-rules/2026.ts` — typed `TaxYearRules` constants (brackets, FICA, limits, credits, OT deduction).
- `tax-engine.ts` — pure `computeDetailedTax(input)` + `buildQuickEstimateInput()` + `blankDetailedInput()`.
- `tax_scenarios` table — jsonb inputs + result, soft-deleted; migrated via direct SQL (no drizzle migration file needed since migration ran in-session).
- API routes at `/api/tax-scenarios` (GET/POST/PUT/DELETE), all behind `requireAuthenticatedUser`.
- Frontend client methods in `api.ts`: `listTaxScenarios`, `createTaxScenario`, `updateTaxScenario`, `deleteTaxScenario`.
- `TaxEstimator.tsx` page at `/tax-estimator` (protected); Quick tab auto-populates from paystubs + profile.

## FICA treatment (important for correctness)
- 401(k) does NOT reduce FICA wages.
- HSA and health insurance (Section 125) DO reduce FICA wages.

## Additional Medicare threshold
Per-filing-status: Single/HoH $200k, MFJ $250k, MFS $125k. The older `tax-estimator.ts` used a flat $200k for all statuses — the new engine fixes this.
