# Security & Production Hardening Baseline

**Branch:** `security-and-production-hardening`  
**Date:** 2026-08-03  
**Monorepo root:** `/home/runner/workspace`  
**Artifacts audited:** `artifacts/api-server`, `artifacts/blue-collar-financial-ai`, `artifacts/mockup-sandbox`

---

## 1. Current Build Status

### `pnpm install`
**Result: ✅ SUCCESS**
```
Lockfile is up to date, resolution step is skipped
Packages: -4
Done in 1.8s using pnpm v10.26.1
```
Warning: `tesseract.js@7.0.0` build scripts are ignored (`pnpm approve-builds` needed to enable).  
Note: pnpm 10.26.1 → 11.20.0 update available.

---

### `pnpm run typecheck`
**Result: ✅ SUCCESS — zero errors across all packages**
```
artifacts/api-server            typecheck  Done in 2.4s
artifacts/blue-collar-financial-ai typecheck  Done in 2.9s
artifacts/mockup-sandbox        typecheck  Done in 3.1s
scripts                         typecheck  Done in 1.2s
```

---

### `pnpm run build`
**Result: ❌ FAILS**

| Artifact | Build result | Reason |
|---|---|---|
| `api-server` | ✅ Success | esbuild bundle: `dist/index.mjs` (2.2 MB), 311 ms |
| `blue-collar-financial-ai` | ❌ Fails | `vite.config.ts` throws at config-load time if `PORT` env var absent |
| `mockup-sandbox` | ❌ Fails | Same `PORT` requirement in its `vite.config.ts` |

**Root cause (vite.config.ts lines 8-15):**
```ts
const rawPort = process.env.PORT;
if (!rawPort) {
  throw new Error('PORT environment variable is required but was not provided.');
}
```
`PORT` and `BASE_PATH` are Replit-injected at runtime. The Vite config was written for `dev` mode where the env is always present, but `vite build` runs in a clean CI context without those variables. This blocks any offline CI build.

---

## 2. Current TypeScript Errors

**Zero errors.** All four packages pass `tsc --noEmit` cleanly as of this baseline.

---

## 3. Current Frontend Routes

File: `artifacts/blue-collar-financial-ai/src/App.tsx` (lines 33–49)  
Router base: `import.meta.env.BASE_URL` (Vite-injected, equals `BASE_PATH` env var)

| Path | Component | Notes |
|---|---|---|
| `/` | `Welcome` | Landing / entry |
| `/welcome` | `Welcome` | Alias |
| `/onboarding` | `Onboarding` | First-run profile setup |
| `/scanner` | `Scanner` | Document upload & AI scan |
| `/dashboard` | `Dashboard` | Net-worth overview |
| `/documents/review` | `DocumentsReview` | Two-phase scan confirm UI |
| `/documents` | `Documents` | Document history list |
| `/paystubs` | `Paystubs` | Paystub list |
| `/debts` | `Debts` | Debt tracker |
| `/bills` | `Bills` | Bill tracker |
| `/banking` | `Banking` | Bank account list |
| `/investments` | `Investments` | Investment/retirement accounts |
| `/scenario` | `Scenario` | What-if financial scenarios |
| `/settings` | `Settings` | Profile, import/export, history |
| `/ask-ai` | `AskAI` | Streaming AI chat |
| `/test-lab` | `TestLab` | Developer-only scanner QA tool |
| `*` | `NotFound` | 404 fallback |

`/test-lab` has no navigation link in `Shell.tsx` — access by direct URL only. No authentication guard.

---

## 4. Current Backend API Routes

File: `artifacts/api-server/src/`  
All routes mounted under the `/api` prefix in `app.ts:32`.

| Method | Path | File | Description |
|---|---|---|---|
| `GET` | `/api/healthz` | `routes/health.ts:6` | Liveness probe (no body) |
| `GET` | `/api/health` | `routes/health.ts:12` | Health check with uptime/version |
| `POST` | `/api/scan-document` | `routes/scan.ts:170` | Upload file → AI extraction; multer `memoryStorage`, 20 MB limit |
| `POST` | `/api/ai/ask` | `routes/ai-ask.ts:14` | Streaming AI chat; forwards `question` + `profile` JSON |
| `GET` | `/api/capabilities` | `routes/ai-ask.ts:89` | Returns available AI model info |
| `USE` | `/api/*` | `app.ts:36` | Catch-all structured 404 for unknown API paths |

Middleware stack (in order, `app.ts`):
1. `pinoHttp` — structured request logging (redacts `authorization`, `cookie` headers)
2. `cors()` — **no origin restriction** (see §7)
3. `express.json()` — JSON body parser (**no explicit size limit**)
4. `express.urlencoded({ extended: true })` — form body parser
5. `/api` router

**Missing middleware:** `helmet`, `express-rate-limit`, authentication, `express-validator`.

---

## 5. Current Environment Variables Used

### API Server (`artifacts/api-server/`)

| Variable | Required | Used in | Purpose |
|---|---|---|---|
| `PORT` | Yes | `src/index.ts:4` | HTTP listen port |
| `NODE_ENV` | No | `src/lib/logger.ts:3` | Log level / pretty-print toggle |
| `LOG_LEVEL` | No | `src/lib/logger.ts:6` | Override pino log level |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Yes | `src/routes/scan.ts:19`, `src/routes/ai-ask.ts:8` | Replit AI proxy base URL |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Yes | `src/routes/scan.ts:20`, `src/routes/ai-ask.ts:9` | Replit AI proxy key |

### Frontend Build (`artifacts/blue-collar-financial-ai/`)

| Variable | Required | Used in | Purpose |
|---|---|---|---|
| `PORT` | **Yes (throws)** | `vite.config.ts:8` | Dev server + preview port |
| `BASE_PATH` | **Yes (throws)** | `vite.config.ts:22` | Vite `base` config (URL prefix) |
| `NODE_ENV` | No | `vite.config.ts:36` | Enables Replit dev plugins |
| `REPL_ID` | No | `vite.config.ts:37` | Enables Replit dev plugins |

Runtime frontend env (available after build via `import.meta.env`):
- `import.meta.env.BASE_URL` — router base path (`App.tsx:61`)
- `import.meta.env.DEV` — dev-mode flag (`Scanner.tsx:489`)

---

## 6. Current Test Coverage

**Zero automated tests.**

No test framework (jest, vitest, mocha, playwright) is configured in any `package.json`. No `*.test.ts`, `*.spec.ts`, or `__tests__/` directories exist anywhere in the monorepo.

| Layer | Coverage |
|---|---|
| Unit tests | ❌ None |
| Integration tests | ❌ None |
| End-to-end tests | ❌ None |
| API contract tests | ❌ None |
| Build/CI checks | ✅ `pnpm run typecheck` (TypeScript only) |

**Test Lab** (`/test-lab`, `src/pages/TestLab.tsx`) is a *manual developer tool* that calls the live AI API with synthetic fixtures — it is not a repeatable automated test suite.  
50 fixtures across 6 categories: Banking (7), Income (5), Debts (8), Investments (11), Bills (11), File Types (8).

---

## 7. Known Security Weaknesses

Severity levels: 🔴 HIGH · 🟠 MEDIUM · 🟡 LOW

### 🔴 HIGH — No CORS Origin Restriction
**File:** `artifacts/api-server/src/app.ts:28`  
```ts
app.use(cors()); // accepts requests from ANY origin
```
Any website can make cross-origin requests to the API. Since the API calls paid AI services, this allows abuse from third-party pages.

---

### 🔴 HIGH — No Rate Limiting
No `express-rate-limit` or equivalent on any route. `POST /api/scan-document` and `POST /api/ai/ask` each invoke the OpenAI-compatible API (which has real cost). A single unauthenticated caller can flood the service with unlimited requests.

---

### 🔴 HIGH — No Authentication on Any Route
Every API endpoint is publicly accessible to anyone who knows the URL. There is no JWT, session token, API key check, or Replit Auth guard on any route. The `/test-lab` frontend page is also unguarded.

---

### 🔴 HIGH — No Helmet / Security Headers
**File:** `artifacts/api-server/src/app.ts`  
`helmet` is not installed. The API returns no security headers:
- No `Content-Security-Policy`
- No `X-Frame-Options`
- No `Strict-Transport-Security`
- No `X-Content-Type-Options`
- No `Referrer-Policy`
- No `Permissions-Policy`

---

### 🟠 MEDIUM — No File Type Validation on Upload
**File:** `artifacts/api-server/src/routes/scan.ts:13-16`  
Multer has no `fileFilter` callback. Any file type is accepted by the upload middleware. Magic-byte detection (`detectMime`, scan.ts) runs *after* the full file is buffered in memory — a crafted file reaches the parse step before being rejected.

---

### 🟠 MEDIUM — No Input Validation on AI Chat
**File:** `artifacts/api-server/src/routes/ai-ask.ts`  
Only a presence check is performed on `question` (line 20-23). No length limit, no schema validation, and no prompt injection detection before the question and full financial `profile` JSON are forwarded to the AI model.

---

### 🟠 MEDIUM — No JSON Body Size Limit
**File:** `artifacts/api-server/src/app.ts:29`  
```ts
app.use(express.json()); // Express default: 100 kB
```
No explicit limit is set. The Express default is 100 kB, which may be insufficient for the `POST /api/ai/ask` route that accepts an entire financial profile JSON payload.

---

### 🟠 MEDIUM — `dangerouslySetInnerHTML` in Chart Component
**File:** `artifacts/blue-collar-financial-ai/src/components/ui/chart.tsx:78`  
Injects CSS custom properties built from chart config:
```tsx
dangerouslySetInnerHTML={{
  __html: Object.entries(THEMES).map(([theme, prefix]) => `
${prefix} [data-chart=${id}] {
  --color-${key}: ${color};
`)
}}
```
Values flow from chart component props — currently sourced from application constants, not raw user input. However, if any color or key value were to come from user-controlled data (e.g., institution names, account labels), this becomes an XSS vector. No sanitization is applied.

---

### 🟠 MEDIUM — All Financial Data in Unencrypted localStorage
**Files:** `src/lib/store.tsx:267,276`, `src/lib/jobQueue.tsx:54`, `src/pages/Scanner.tsx:601`  
localStorage keys:
- `bcf_state` — complete financial profile (assets, debts, bills, paystubs, change history, computed metrics)
- `bcf_jobs` — background job queue
- `bcf_custom_institutions` — custom institution names

Any browser extension, injected script, or XSS payload can exfiltrate the entire financial profile. No encryption at rest. No session expiry. Data persists indefinitely.

---

### 🟠 MEDIUM — Settings Import Accepts Arbitrary JSON
**File:** `artifacts/blue-collar-financial-ai/src/pages/Settings.tsx:93`  
```ts
localStorage.setItem('bcf_state', text); // raw user-supplied JSON
```
The import function reads a file, JSON-parses it, and writes it directly to `bcf_state` with no schema validation. A malformed or malicious import can corrupt application state silently.

---

### 🟡 LOW — Build Requires Runtime Environment Variables
**File:** `artifacts/blue-collar-financial-ai/vite.config.ts:8-15`  
`PORT` and `BASE_PATH` are required at Vite *config load time*. This prevents running `vite build` in any environment that does not pre-set Replit's injected variables (CI, Docker, local dev without the Replit runner).

---

### 🟡 LOW — pnpm Version Outdated
Running 10.26.1; 11.20.0 is available. Not a security issue but relevant to dependency resolution correctness.

---

### 🟡 LOW — OpenAI API Key Logged on Crash
If the OpenAI client throws an error that includes configuration details, and structured logging is set to `debug`/`trace`, the API key could appear in logs. The logger redacts `authorization` headers (logger.ts:8-10) but does not sanitize error object properties.

---

## 8. Current Data-Storage Architecture

The application is **entirely stateless on the server.** All persistence is client-side.

### Client-side (browser localStorage)

| Key | Set in | Contents |
|---|---|---|
| `bcf_state` | `src/lib/store.tsx` | Full financial state: assets, debts, bills, paystubs, investments, change history records, computed metrics |
| `bcf_jobs` | `src/lib/jobQueue.tsx` | Background job queue (scan jobs, status, progress) |
| `bcf_custom_institutions` | `src/pages/Scanner.tsx` | User-defined institution names |

State is serialized as JSON on every mutation (`store.tsx:276`) and deserialized on mount (`store.tsx:267`). No TTL, no versioning, no migration path.

### Server-side (API)

**No persistence whatsoever.** The API server:
- Accepts file uploads via `multer.memoryStorage()` — buffers live in RAM for the duration of the request then are garbage-collected
- Parses PDFs in memory (`pdf-parse`)
- Has no database connection (Drizzle ORM is listed as a dependency in `package.json` but no usage exists in `src/`)
- Writes no files to disk
- Maintains no session store

### Import / Export

Users can manually export `bcf_state` as a JSON file and re-import it via `Settings.tsx`. This is the only data portability mechanism.

---

## 9. Current AI Model Usage

**Model:** `gpt-5.6-terra`  
**Provider:** Replit AI Integrations proxy (OpenAI-compatible API)  
**Client:** `openai` npm package, configured via `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY`

### Call 1 — Document Scanning
**Route:** `POST /api/scan-document` (`routes/scan.ts:128-148`)  
**Type:** Non-streaming chat completion with vision  
**Input:**
- System prompt: `SYSTEM_PROMPT` (`scan.ts:42-121`) — 80-line detailed financial document extraction spec covering 10+ doc types, field definitions, confidence scoring, institution extraction
- User message: base64-encoded image (JPEG/PNG/WEBP/GIF) OR extracted PDF text
**Output:** Structured JSON — `docType`, `institution`, `fields` (key → `{value, confidence}`)  
**Retry:** None (single attempt per upload)

### Call 2 — AI Financial Advisor Chat
**Route:** `POST /api/ai/ask` (`routes/ai-ask.ts:54-60`)  
**Type:** Streaming chat completion (`stream: true`)  
**Input:**
- System prompt: `systemPrompt` (`ai-ask.ts:28-51`) — financial advisor persona with financial health awareness
- Context: full financial profile JSON from request body (`profile`)
- User message: `question` from request body
**Output:** Server-Sent Events stream of text chunks  
**Retry:** None

### Prompt Injection Risk
Neither route applies any sanitization or detection for adversarial prompt content before forwarding to the model. A crafted `question` or malicious content in a scanned document field could attempt to override the system prompt.

---

## 10. Files That Will Likely Need Modification

### API Server — `artifacts/api-server/`

| File | Why it needs modification |
|---|---|
| `src/app.ts` | Add `helmet`, `express-rate-limit`, CORS origin whitelist |
| `src/routes/scan.ts` | Add multer `fileFilter` (MIME allowlist), explicit request size cap, validate file extension vs. magic bytes |
| `src/routes/ai-ask.ts` | Add input length limits on `question` (e.g., 2 000 chars), schema validation on `profile`, basic prompt injection detection |
| `src/routes/health.ts` | Consider removing or guarding `/api/capabilities` which exposes model name |
| `package.json` | Add `helmet`, `express-rate-limit`, `express-validator` (or `zod`) dependencies |

### Frontend — `artifacts/blue-collar-financial-ai/`

| File | Why it needs modification |
|---|---|
| `vite.config.ts` | Make `PORT` / `BASE_PATH` optional during `vite build` (fall back to defaults or skip the hard throw) |
| `src/components/ui/chart.tsx` | Sanitize or validate chart config values before injecting into `dangerouslySetInnerHTML`; use CSS-safe character allowlist |
| `src/pages/Settings.tsx` | Validate imported JSON against the `bcf_state` schema before writing to localStorage; show user-friendly error on invalid import |
| `src/pages/TestLab.tsx` | Add authentication guard (dev-only check) so it's not accessible in production builds |

### Infrastructure / Config

| File | Why it needs modification |
|---|---|
| Root `package.json` | (Optional) Add `pnpm run audit` script using `pnpm audit` for dependency CVE checking |
| `artifacts/api-server/.env.example` | Create to document required env vars for operators |

---

## Summary Table

| Category | Status |
|---|---|
| TypeScript | ✅ Zero errors |
| `pnpm install` | ✅ Clean |
| Full `pnpm run build` | ❌ Fails (PORT missing at build time) |
| `api-server` build alone | ✅ Passes |
| Automated test coverage | ❌ None |
| CORS | ❌ Unrestricted |
| Rate limiting | ❌ Missing |
| Authentication | ❌ Missing |
| Security headers (Helmet) | ❌ Missing |
| File upload validation | ⚠️ Partial (size limit only) |
| Input validation | ⚠️ Presence check only |
| Data encryption at rest | ❌ Missing (localStorage plaintext) |
| Prompt injection protection | ❌ Missing |
| Build reproducibility | ❌ Requires Replit runtime env |
