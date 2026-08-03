---
name: Blue Collar Financial AI — Architecture
description: Key decisions, routing, and integration details for the BCFAI project.
---

# Blue Collar Financial AI Architecture

## Structure
- Frontend: `artifacts/blue-collar-financial-ai` — React + Vite, all user data in `localStorage` via `StoreProvider` (`src/lib/store.tsx`)
- API Server: `artifacts/api-server` — Express, handles file scan (OpenAI Vision) and AI chat (streaming SSE)
- No database — demo mode and real mode both use `localStorage`

## AI Integration
- Uses Replit AI Integrations (no user API key needed): env vars `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY`
- Model used: `gpt-5.6-terra` for both scan extraction and AI chat
- Scan: `POST /api/scan` — multer memory storage, MIME detected from magic bytes, image→base64→Vision, PDF→pdf-parse text→GPT
- AI chat: `POST /api/ai/ask` — streaming SSE, receives confirmed financial profile JSON + question
- `GET /api/capabilities` — returns `{"ai":true}` when OpenAI is configured

## Frontend API client
- `src/lib/api.ts` — calls `/api-server/api/...` (absolute path routes through Replit shared proxy)
- `scanFile(file)` — POST FormData to `/api/scan`
- `askAI(question, profile, onDelta)` — streaming SSE consumer

## Key routing
- `/` and `/welcome` → Welcome page (full screen, no Shell nav)
- `/scanner` → Scanner wizard (full screen, no Shell nav)
- `/ask-ai` → AskAI chat page (shown in Shell with nav)
- Shell hides on: `'/'`, `'/welcome'`, `'/onboarding'`, and paths starting with `'/scanner'`

## PDF handling
- Uses `pdf-parse@1.1.1` (NOT v2 — v2 broke ESM default export with esbuild)
- Import via `createRequire` in scan.ts to avoid esbuild ESM resolution issue
- Scanned PDFs with no embedded text are rejected with a helpful message

## Scanner flow
- Upload → `scanFile()` per file sequentially → Review (per-doc classification + editable fields) → Confirm saves to store
- Per-document type has its own field definitions in `DOC_FIELDS` map
- After confirm: Paystub→addPaystub, Bank→addAsset(Cash), CC/Loan/Mortgage→addDebt, Investment/Retirement→addAsset(Investment), Bill→addBill

## Dashboard Health Score
- Calculated from: cash flow, emergency fund coverage, credit utilization, DTI, high-interest debt, retirement
- Only penalizes categories where confirmed data exists (no paystubs = no score)
- Uses recharts `BarChart` for monthly cash flow visualization

## API Abuse Protection (added security-and-production-hardening branch)
- CORS: `makeCors()` in `middlewares/cors.ts` — dev allows localhost/replit.dev/replit.app; prod requires ALLOWED_ORIGINS env var
- Rate limits (express-rate-limit, in-memory): general 100/15min, AI ask 20/hr, scan 10/hr — all 429s include Retry-After
- Concurrency: `PerIpConcurrencySemaphore` (scan, 3/IP), `GlobalConcurrencySemaphore` (AI, AI_MAX_CONCURRENT_REQUESTS default 10)
- Kill switch: `aiKillSwitch` reads AI_ENABLED at request time — false/0 → 503
- Timeouts: `makeAbortController(res, ms)` passes AbortSignal to OpenAI calls; scan=90s, AI ask=60s
- JSON body cap: `express.json({ limit: '250kb' })`
- Env vars: AI_ENABLED (default true), AI_MAX_CONCURRENT_REQUESTS (default 10), ALLOWED_ORIGINS (empty = prod blocks all cross-origin)

**Why:** These decisions are not obvious from code alone and will affect any future changes to file handling, AI routing, or nav structure.
