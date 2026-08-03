import { SignIn as ClerkSignIn } from '@clerk/react';

export default function SignIn() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-5">
        <div className="text-center text-white">
          <div className="text-2xl font-bold">Blue Collar AI</div>
          <p className="mt-2 text-sm text-slate-300">
            Sign in to protect and access your financial workspace.
          </p>
        </div>
        <ClerkSignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/dashboard"
        />
      </div>
    </div>
  );
}
