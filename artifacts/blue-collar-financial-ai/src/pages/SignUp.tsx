import { SignUp as ClerkSignUp } from '@clerk/react';

export default function SignUp() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-5">
        <div className="text-center text-white">
          <div className="text-2xl font-bold">Blue Collar AI</div>
          <p className="mt-2 text-sm text-slate-300">
            Create your private financial workspace.
          </p>
        </div>
        <ClerkSignUp
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          fallbackRedirectUrl="/onboarding"
        />
      </div>
    </div>
  );
}
