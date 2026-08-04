# Blue Collar AI — Security Hardening Plan

This branch is intentionally developed in reviewable stages. `main` is not modified until the pull request is reviewed and merged.

## Stage 1 — Baseline and strict validation

- [x] Baseline security and architecture review
- [x] Zod validation for Ask AI requests
- [x] Zod validation for AI extraction output
- [x] Structured 400/422 validation responses
- [x] Validation tests

## Stage 2 — API abuse and cost protection

- [x] General API rate limiting
- [x] Stricter scan and AI-chat limits
- [x] Per-IP scan concurrency limit
- [x] Shared global AI concurrency limit
- [x] AI kill switch covering scan and chat
- [x] Request cancellation and timeout controls
- [x] 250 KB JSON/form request limit
- [x] Structured 413 and 429 responses
- [x] Production CORS allowlist
- [x] Safe wildcard origin support
- [x] Reverse-proxy-aware client IP handling

## Stage 3 — Authentication and authorization

- [x] Select Clerk as the branded customer authentication provider
- [x] Add server-verified Clerk sessions
- [x] Protect financial pages and paid AI endpoints
- [x] Add current-user endpoint and sign-out controls
- [x] Disable developer Test Lab in production by default
- [x] Configure Clerk keys in Replit
- [x] Complete initial sign-up and email-verification test
- [ ] Complete explicit signed-out API and protected-page verification
- [ ] Add automated auth middleware tests

## Stage 4 — Upload security

- [x] Replace extension-based fallback with verified file-signature detection
- [x] Decode HEIC/HEIF instead of relabeling bytes as JPEG
- [x] Correct EXIF orientation
- [x] Normalize images to clean JPEG and strip metadata
- [x] Reduce upload limit to 10 MB
- [x] Enforce 25-megapixel decoded image limit
- [x] Reject oversized scanner requests before buffering when Content-Length is available
- [x] Enforce one-file multipart uploads
- [x] Add PDF page limit
- [x] Add encrypted/corrupt PDF handling
- [x] Add zero-byte, fake-extension, corrupt-image, and oversized-file tests
- [ ] Render and process scanned/image-only PDF pages
- [ ] Add real HEIC fixture coverage in Replit/CI
- [ ] Add complete PDF fixture suite

## Stage 5 — Document prompt-injection safety

- [x] Treat document content as untrusted data in scanner prompts
- [x] Delimit extracted PDF text from trusted instructions
- [x] Sanitize PDF control characters and enforce text length limit
- [x] Detect common instruction-like phrases in PDF text
- [x] Return non-sensitive security warnings to the review UI payload
- [ ] Add image-document injection evaluation coverage

## Stage 6 — Financial correctness

- [x] Add deterministic calculation engine
- [x] Correct gross-income DTI calculation
- [x] Add proper revolving utilization requiring credit limits
- [x] Sort paystubs by actual date
- [x] Support variable-income averages and medians
- [x] Return completeness, formula, inputs, timestamp, and warning metadata
- [x] Add calculation regression tests
- [ ] Replace legacy store and dashboard calculations with the new engine
- [ ] Replace the legacy health-score formula with transparent scored components

## Stage 7 — Matching and duplicate safety

- [x] Add scored and explainable account matcher
- [x] Require confirmation for ambiguous or institution-only matches
- [x] Preserve word boundaries for token-based matching
- [x] Add SHA-256 content fingerprinting
- [x] Add matching and duplicate tests
- [ ] Wire matcher and fingerprints into scanner confirmation UI

## Stage 8 — Persistent user-owned storage

- [x] Add PostgreSQL and Drizzle financial schema
- [x] Add user ownership to every financial record
- [x] Add document, import-job, change-history, link, preference, and AI-usage tables
- [x] Add user-scoped repository layer
- [x] Add authenticated snapshot and create/delete API foundation
- [ ] Generate and apply database migration in Replit
- [ ] Add transactional document import and undo service
- [ ] Add localStorage migration flow
- [ ] Add cross-user authorization tests
- [ ] Switch frontend source of truth from localStorage to API storage

## Stage 9 — AI tools and explanation safety

- [x] Use deterministic server calculations before AI explanation
- [x] Remove raw profile JSON from trusted system instructions
- [x] Separate untrusted question text from trusted numeric context
- [x] Add facts/calculations/estimates/missing-information response rules
- [x] Improve stream cancellation and proxy-buffering behavior
- [x] Add deterministic financial-context regression tests
- [ ] Update frontend stream parser to surface errors and support user cancellation

## Stage 10 — Privacy, CI, and production audit

- [ ] Accurate privacy and AI-processing disclosures
- [ ] User data export and account deletion
- [ ] Versioned backup import/export
- [ ] Complete unit, API, and end-to-end test commands
- [ ] GitHub Actions
- [ ] Dependency and secret scanning
- [ ] Monitoring and cost metrics
- [ ] Final production-readiness report

## Replit sync status

The Replit workspace currently has an interrupted rebase caused by local Clerk commits and remote scanner-security commits both editing `artifacts/api-server/package.json`. The package-file conflict was resolved by selecting the Clerk-side version, but it has not yet been staged and the rebase has not yet continued.

The first commands during the next sync session are:

```bash
git add artifacts/api-server/package.json
GIT_EDITOR=true git rebase --continue
```

Continue resolving conflicts without discarding either authentication dependencies or the newer scanner/database dependencies. After the rebase finishes, run `pnpm install` so the lockfile includes Clerk, Sharp, file-type, and Vitest.

## Merge policy

Do not merge this branch until typecheck, tests, database migration, build, authentication checks, scanner checks, and basic financial-data API checks pass in Replit or GitHub Actions. Each stage should remain independently reviewable and reversible.
