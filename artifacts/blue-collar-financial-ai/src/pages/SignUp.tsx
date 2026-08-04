import { SignUp as ClerkSignUp } from '@clerk/react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export default function SignUp() {
  return (
    <div className="min-h-[100dvh] bg-slate-950 flex items-center justify-center p-4">
      {/* path must be the full browser path — Clerk reads window.location.pathname directly */}
      <ClerkSignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        fallbackRedirectUrl={`${basePath}/onboarding`}
      />
    </div>
  );
}
