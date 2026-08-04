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

Database-backed record ownership and cross-user authorization remain part of the persistence stage because the current financial store is still localStorage-based.

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
- [ ] Add adversarial prompt-injection fixtures and automated tests
- [ ] Add image-document injection evaluation coverage

## Stage 6 — Financial correctness

- [ ] Deterministic calculation engine
- [ ] Correct gross-income DTI
- [ ] Correct revolving utilization
- [ ] Sort paystubs by date
- [ ] Support variable-income averages and medians
- [ ] Return completeness and warning metadata
- [ ] Add calculation tests

## Stage 7 — Matching and duplicate safety

- [ ] Scored account matcher
- [ ] Require confirmation for ambiguous matches
- [ ] Fix token-based fuzzy matching
- [ ] Content-hash duplicate detection
- [ ] Add matching and duplicate tests

## Stage 8 — Persistent user-owned storage

- [ ] PostgreSQL and Drizzle schema
- [ ] User ownership on every financial record
- [ ] Transactional imports and undo
- [ ] LocalStorage migration flow
- [ ] Cross-user authorization tests

## Stage 9 — AI tools and explanation safety

- [ ] Use deterministic financial tools before AI explanation
- [ ] Remove raw profile JSON from trusted instruction text
- [ ] Separate facts, calculations, estimates, and missing information
- [ ] Fix stream-error swallowing and add cancellation
- [ ] Add financial-advice boundary tests

## Stage 10 — CI and production audit

- [ ] Unit, API, and end-to-end test commands
- [ ] GitHub Actions
- [ ] Dependency and secret scanning
- [ ] Monitoring and cost metrics
- [ ] Final production-readiness report

## Replit sync status

The Replit workspace currently has an interrupted rebase caused by local Clerk commits and remote scanner-security commits both editing `artifacts/api-server/package.json`. The conflict was resolved by selecting the Clerk-side package file, but it has not yet been staged and the rebase has not yet continued. The first command during the next sync session is:

```bash
git add artifacts/api-server/package.json
```

Then continue the rebase and resolve any remaining conflicts without discarding either authentication or scanner-security dependencies.

## Merge policy

Do not merge this branch until the current stage passes typecheck, tests, and build in Replit or GitHub Actions. Each stage should remain independently reviewable and reversible.
