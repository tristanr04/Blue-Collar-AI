# Replit AI Post-Merge Handoff

Use this checklist immediately after merging the `security-and-production-hardening` pull request into `main`.

## Goal

Finish environment configuration, verify the hardened app, and integrate the new deterministic financial and persistence foundations without weakening authentication, upload validation, rate limits, prompt-injection boundaries, or user ownership.

## First commands

```bash
pnpm install
pnpm run typecheck
pnpm test
PORT=3000 BASE_PATH=/ pnpm run build
```

Do not remove Clerk, Sharp, file-type, Vitest, Drizzle, Zod, rate limiting, CORS, timeout, or AI guard dependencies to make a command pass. Fix the underlying conflict or type error instead.

## Required Replit Secrets

Confirm these exist in Replit Secrets and never commit their real values:

```text
VITE_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
AI_INTEGRATIONS_OPENAI_BASE_URL=...
AI_INTEGRATIONS_OPENAI_API_KEY=...
DATABASE_URL=postgresql://...
```

Set the production frontend origin explicitly in `ALLOWED_ORIGINS`. Keep `AI_ENABLED=true` and `AI_MAX_CONCURRENT_REQUESTS=10` unless there is a deliberate operational reason to change them.

## Database setup

1. Inspect the Drizzle configuration and `lib/db/src/schema/financial.ts`.
2. Generate a migration for the financial tables.
3. Review the generated SQL before applying it.
4. Apply it to the Replit PostgreSQL database.
5. Verify a signed-in user can create and retrieve only their own records.
6. Verify a second test user cannot read, update, or delete the first user's records.

Do not expose `userId` as a client-controlled ownership field. Ownership must always come from the verified Clerk session.

## Integration order

### 1. Deterministic dashboard calculations

Replace the legacy calculations in `src/lib/store.tsx` and any duplicated calculations in `Dashboard.tsx` with the functions in `src/lib/financial-calculations.ts`.

Requirements:
- Select the newest paystub by its actual date, not array position.
- Calculate DTI using gross monthly income.
- Keep the net-obligation ratio separate from DTI.
- Calculate revolving utilization only from revolving accounts that have real credit limits.
- Calculate free cash flow from net income minus bills and minimum debt payments.
- Exclude investments from emergency-fund cash.
- Preserve calculation formula, inputs, completeness, warnings, and calculation timestamp for UI explanations.
- Do not silently substitute zero for missing required data; show incomplete or insufficient states.

### 2. Scanner matching and duplicate protection

Wire `src/lib/account-matching.ts` into the scanner review/confirmation flow.

Requirements:
- Fingerprint the uploaded file before confirmation.
- Warn and block accidental duplicate imports for the same user unless the user explicitly chooses to continue.
- Automatic account matching is allowed only for a unique high-confidence match with exact last-four digits.
- Institution-only, account-type-only, or ambiguous matches require user confirmation.
- Display why the account matched, the score, and any conflicting or missing signals.
- Never overwrite an existing account merely because the institution name matches.

### 3. Authenticated API persistence

Gradually switch the frontend source of truth from `localStorage` to `/api/financial/*`.

Requirements:
- Include the Clerk session token on authenticated API requests.
- Load the server snapshot after Clerk is ready.
- Keep a one-time migration path for existing local data.
- Ask the user before uploading legacy local data.
- Use transactional writes for confirmed document imports.
- Preserve undo/change-history behavior.
- Do not delete local data until the server confirms a successful migration.
- Avoid duplicate migration on refresh or sign-in.

### 4. Ask AI stream handling

Update the frontend stream parser so it:
- handles structured HTTP errors before reading SSE;
- surfaces streamed `{ error }` messages;
- supports user cancellation with `AbortController`;
- stops cleanly at `[DONE]`;
- does not retry automatically after a chargeable AI request unless the user chooses retry.

## Mandatory verification

Run these checks after integration:

1. Signed-out `/welcome` works.
2. Signed-out protected pages redirect to `/sign-in`.
3. Signed-out scan and Ask AI requests return 401.
4. Signed-in scan accepts valid JPG, PNG, WebP, HEIC/HEIF, and text PDFs.
5. Zero-byte, fake-extension, corrupt, oversized, encrypted, and over-page-limit files are rejected with user-friendly errors.
6. Image-only PDFs explain that page images must currently be uploaded separately.
7. Duplicate documents are detected per user.
8. Ambiguous account matches require confirmation.
9. Bills, debts, assets, and paystub totals update the dashboard correctly.
10. DTI uses gross income and free cash flow uses net income.
11. Ask AI explains server-calculated figures and does not trust malicious account labels or document instructions.
12. Two-user authorization tests prove records are isolated.
13. `pnpm run typecheck`, `pnpm test`, and the production build pass.

## Do not weaken these safeguards

- Clerk authentication and server-derived user IDs
- 10 MB upload limit
- 25-megapixel decoded image limit
- verified magic-byte file detection
- image normalization and metadata stripping
- PDF page and text limits
- prompt-injection boundaries
- API and endpoint rate limits
- AI kill switch, timeouts, and concurrency ceilings
- production CORS allowlist
- deterministic calculations before AI explanations

## Completion report

When done, report:
- commands run and exact results;
- migrations generated and applied;
- files changed;
- manual tests completed;
- any failures or remaining risks;
- whether the app is safe to publish or still requires work.
