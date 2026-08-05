import { SignIn as ClerkSignIn } from '@clerk/react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export default function SignIn() {
  return (
    <div className="min-h-[100dvh] bg-slate-950 flex items-center justify-center p-4">
      {/* path must be the full browser path — Clerk reads window.location.pathname directly */}
      <ClerkSignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        fallbackRedirectUrl={`${basePath}/dashboard`}
      />
    </div>
  );
}
