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
- [ ] Configure Clerk keys in Replit
- [ ] Run signed-in and signed-out verification tests
- [ ] Add automated auth middleware tests

Database-backed record ownership and cross-user authorization remain part of the persistence stage because the current financial store is still localStorage-based.

## Stage 4 — Upload security

- [ ] Replace extension-based fallback with verified decoding
- [ ] Add real HEIC/HEIF conversion
- [ ] Correct EXIF orientation
- [ ] Normalize images and strip metadata
- [ ] Reduce upload limits and enforce pixel limits
- [ ] Add PDF limits and encrypted-PDF handling
- [ ] Add adversarial upload tests

## Stage 5 — Financial correctness

- [ ] Deterministic calculation engine
- [ ] Correct gross-income DTI
- [ ] Correct revolving utilization
- [ ] Sort paystubs by date
- [ ] Support variable-income averages and medians
- [ ] Return completeness and warning metadata
- [ ] Add calculation tests

## Stage 6 — Matching and duplicate safety

- [ ] Scored account matcher
- [ ] Require confirmation for ambiguous matches
- [ ] Fix token-based fuzzy matching
- [ ] Content-hash duplicate detection
- [ ] Add matching and duplicate tests

## Stage 7 — Persistent user-owned storage

- [ ] PostgreSQL and Drizzle schema
- [ ] User ownership on every financial record
- [ ] Transactional imports and undo
- [ ] LocalStorage migration flow
- [ ] Cross-user authorization tests

## Stage 8 — AI safety and deterministic tools

- [ ] Treat document and profile strings as untrusted data
- [ ] Detect document prompt injection
- [ ] Use deterministic financial tools before AI explanation
- [ ] Remove raw profile JSON from trusted instructions
- [ ] Fix stream-error swallowing and add cancellation

## Stage 9 — CI and production audit

- [ ] Unit, API, and end-to-end test commands
- [ ] GitHub Actions
- [ ] Dependency and secret scanning
- [ ] Monitoring and cost metrics
- [ ] Final production-readiness report

## Merge policy

Do not merge this branch until the current stage passes typecheck, tests, and build in Replit or GitHub Actions. Each stage should remain independently reviewable and reversible.
