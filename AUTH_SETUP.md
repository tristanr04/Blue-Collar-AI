# Clerk Authentication Setup

Blue Collar AI now uses Clerk for branded customer authentication. The application fails closed when the frontend publishable key is missing, and the API rejects unauthenticated scan/chat requests with HTTP 401.

## 1. Provision Clerk in Replit

Open the Replit **Auth** pane and choose **Clerk Auth**. Replit should provision or connect the Clerk application.

## 2. Required Replit Secrets

Set these values in Replit Secrets. Never commit their actual values to GitHub.

```text
VITE_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
```

Optional developer access:

```text
VITE_ENABLE_TEST_LAB=false
CLERK_ADMIN_USER_IDS=user_abc123,user_def456
```

`VITE_ENABLE_TEST_LAB` should remain false in production. The Test Lab route is disabled in production unless explicitly enabled, and still requires a signed-in session.

## 3. Install dependencies after pulling

```bash
pnpm install
```

This updates `pnpm-lock.yaml` for the new `@clerk/react` and `@clerk/express` dependencies.

## 4. Restart both artifacts

Restart the frontend and API server after adding Secrets.

## 5. Verification order

1. Visit `/welcome` while signed out — it remains public.
2. Visit `/dashboard` while signed out — it redirects to `/sign-in`.
3. Create an account through `/sign-up`.
4. Confirm successful sign-in redirects to `/dashboard` or `/onboarding`.
5. Confirm `GET /api/auth/me` returns the signed-in user's safe profile fields.
6. Confirm signed-out `POST /api/scan-document` returns 401.
7. Confirm signed-out `POST /api/ai/ask` returns 401.
8. Confirm signed-in scanning and Ask AI still work.
9. Confirm signing out returns to `/welcome` and protected pages become inaccessible.
10. Confirm `/test-lab` is unavailable in production unless deliberately enabled.

## Current boundary

Authentication now verifies identity, but financial records are still stored in browser localStorage. Database-backed user ownership and cross-user authorization will be added in the persistence stage before public launch.
