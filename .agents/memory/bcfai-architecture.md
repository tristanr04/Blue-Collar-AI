---
name: BCFAI Architecture
description: Architecture decisions, key routing details, and integration notes for Blue Collar Financial AI app.
---

## App structure
- Frontend: `artifacts/blue-collar-financial-ai` — React + Vite + Tailwind v4 + Wouter routing
- API server: `artifacts/api-server` — Express + esbuild bundle + pino logging
- Monorepo: pnpm workspaces, shared Zod schemas in `packages/api-zod`

## Auth: Clerk v6
- `@clerk/react@^6.0.0` (NOT v5 — `5.40.0` doesn't exist; v5.54.0 was broken with @clerk/shared)
- `@clerk/express@^1.x` on API server
- Clerk provisioned via Replit Auth pane (NOT clerk dashboard). `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` in Replit Secrets.
- `VITE_CLERK_PROXY_URL` is empty in dev, auto-set in prod — do NOT gate on `NODE_ENV`.

**Why ClerkProvider must be inside WouterRouter:**
`routerPush`/`routerReplace` props need `useLocation` from wouter, which requires being inside `<Router base={basePath}>`. Component: `ClerkProviderWithRoutes` rendered inside `WouterRouter`.

**Clerk v6 export changes vs v5:**
- `SignedIn` / `SignedOut` removed. Use `useAuth()` → `{ isSignedIn, isLoaded }` instead.
- `Show`, `UserButton`, `useAuth`, `useUser`, `useClerk` all still exported from `@clerk/react`.
- `publishableKeyFromHost` from `@clerk/react/internal` NOT needed — use `import.meta.env.VITE_CLERK_PUBLISHABLE_KEY` directly.

## CSS layer order (Tailwind v4 + Clerk)
`index.css` must start with: `@layer theme, base, clerk, components, utilities;`
Then: `@import 'tailwindcss';`

`vite.config.ts` must use `tailwindcss({ optimize: false })` (prevents Clerk theme CSS layer reordering in prod).

## API server build
- esbuild bundles everything to `dist/index.mjs`
- Must add to `external` in `build.mjs`: `@clerk/express`, `@clerk/shared`, `@clerk/shared/*`, `http-proxy-middleware`
- `clerkProxyMiddleware` must be mounted BEFORE body parsers (`express.json`)
- `clerkMiddleware` mounts AFTER body parsers, BEFORE routes

## Route protection order (API)
```
rate limiter → requireAuthenticatedUser → concurrency semaphore → handler
```
- Rate limit fires first (protects even unauthenticated abuse attempts)
- Then auth check (`requireAuthenticatedUser` from `middlewares/auth.ts`)
- `requireAuthenticatedUser` uses `getAuth(req)` from `@clerk/express` and checks `auth.isAuthenticated && auth.userId`

## Frontend route structure
- `/`, `/welcome` — public (Welcome page)
- `/sign-in/*?`, `/sign-up/*?` — Clerk pages (REQUIRED: `/*?` wildcard for OAuth sub-paths)
- All other routes wrapped in `ProtectedPage` (redirects to `/sign-in`)
- Sign-in/sign-up `path` prop must include basePath: `${basePath}/sign-in`

## Existing API server auth files
- `src/middlewares/auth.ts` — `requireAuthenticatedUser`, `requireAdminUser` (use these, don't duplicate)
- `src/routes/auth.ts` — `GET /api/auth/me` returns user profile from Clerk

## App palette (for Clerk appearance)
- `colorPrimary: '#059669'` (emerald-600)
- `colorBackground: '#0f172a'` (slate-900)
- `colorInput: '#1e293b'` (slate-800)
- `colorForeground: '#f8fafc'` (slate-50)
- `borderRadius: '0.5rem'`
- Base theme: `dark` from `@clerk/themes`
- cssLayerName: `'clerk'`
