"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import Button from "@/components/Button";
import SectionHeading from "@/components/SectionHeading";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

function fieldClassName(invalid = false) {
  return invalid
    ? "w-full scroll-mt-24 rounded-xl border-2 border-berry bg-cream px-4 py-2 text-ink outline-none focus:border-berry"
    : "w-full scroll-mt-24 rounded-xl border-2 border-ink/15 bg-cream px-4 py-2 text-ink outline-none focus:border-blush";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/my-orders";
  const customerAuthEnabled = isCustomerAuthEnabled();
  const { signIn, signUp, user } = useAuth();

  const [mode, setMode] = useState("login"); // "login" or "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    if (!customerAuthEnabled) {
      router.replace("/");
    }
  }, [customerAuthEnabled, router]);

  // If already logged in, redirect
  useEffect(() => {
    if (!customerAuthEnabled) return;
    if (user && !loading) {
      router.push(redirectTo);
    }
  }, [customerAuthEnabled, user, loading, redirectTo, router]);

  if (!customerAuthEnabled || (user && !loading)) {
    return null;
  }

  const validateForm = () => {
    const errors = {};
    
    if (!email.trim()) {
      errors.email = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = true;
    }

    if (!password) {
      errors.password = true;
    } else if (mode === "signup" && password.length < 6) {
      errors.password = true;
    }

    if (mode === "signup" && password !== confirmPassword) {
      errors.confirmPassword = true;
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!isSupabaseConfigured) {
      setError("Authentication is not configured. Please contact support.");
      return;
    }

    if (!validateForm()) {
      setError("Please check the form for errors.");
      return;
    }

    setLoading(true);

    try {
      if (mode === "login") {
        await signIn(email, password);
        router.push(redirectTo);
      } else {
        const data = await signUp(email, password);

        // With email confirmation on, signup returns no session. Send the user
        // to the confirm-your-email page instead of the protected redirect.
        if (data.session) {
          router.push(redirectTo);
        } else {
          router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        }
      }
    } catch (err) {
      setError(err.message || "An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="animate-fade-up">
        <SectionHeading subtitle={mode === "login" ? "Welcome back!" : "Create your account"}>
          {mode === "login" ? "Log in" : "Sign up"}
        </SectionHeading>
      </div>

      <div className="pixel-border animate-fade-up space-y-6 rounded-2xl bg-cream/60 p-6 [animation-delay:150ms]">
        {!isSupabaseConfigured && (
          <p className="rounded-2xl border-2 border-peach bg-peach/30 px-4 py-3 text-sm text-ink/80">
            Authentication is not configured. Please add{" "}
            <code className="rounded bg-night/50 px-1">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
            and{" "}
            <code className="rounded bg-night/50 px-1">
              NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
            </code>{" "}
            to <code className="rounded bg-night/50 px-1">.env.local</code>.
          </p>
        )}

        {error && (
          <p className="rounded-2xl border-2 border-berry bg-berry/20 px-4 py-3 text-sm font-semibold text-ink">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-bold text-ink">
              Email <span className="text-berry">*</span>
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setFieldErrors((prev) => ({ ...prev, email: false }));
              }}
              placeholder="you@example.com"
              className={fieldClassName(fieldErrors.email)}
              disabled={loading}
              required
            />
            {fieldErrors.email && (
              <p className="mt-1 text-sm text-berry">
                Please enter a valid email address
              </p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-bold text-ink">
              Password <span className="text-berry">*</span>
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setFieldErrors((prev) => ({ ...prev, password: false }));
              }}
              placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
              className={fieldClassName(fieldErrors.password)}
              disabled={loading}
              required
            />
            {fieldErrors.password && mode === "signup" && (
              <p className="mt-1 text-sm text-berry">
                Password must be at least 6 characters
              </p>
            )}
          </div>

          {mode === "signup" && (
            <div>
              <label
                htmlFor="confirm-password"
                className="mb-1 block text-sm font-bold text-ink"
              >
                Confirm Password <span className="text-berry">*</span>
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, confirmPassword: false }));
                }}
                placeholder="Confirm your password"
                className={fieldClassName(fieldErrors.confirmPassword)}
                disabled={loading}
                required
              />
              {fieldErrors.confirmPassword && (
                <p className="mt-1 text-sm text-berry">Passwords do not match</p>
              )}
            </div>
          )}

          <Button type="submit" fullWidth disabled={loading || !isSupabaseConfigured}>
            {loading ? (
              <span className="inline-block animate-soft-bounce">
                {mode === "login" ? "Logging in..." : "Creating account..."}
              </span>
            ) : mode === "login" ? (
              "Log in"
            ) : (
              "Create account"
            )}
          </Button>
        </form>

        <div className="border-t border-ink/10 pt-4 text-center">
          {mode === "login" ? (
            <p className="font-secondary text-sm text-ink/70">
              Don&apos;t have an account?{" "}
              <button
                onClick={() => {
                  setMode("signup");
                  setError("");
                  setFieldErrors({});
                }}
                className="font-semibold text-blush hover:underline"
              >
                Sign up
              </button>
            </p>
          ) : (
            <p className="font-secondary text-sm text-ink/70">
              Already have an account?{" "}
              <button
                onClick={() => {
                  setMode("login");
                  setError("");
                  setFieldErrors({});
                  setConfirmPassword("");
                }}
                className="font-semibold text-blush hover:underline"
              >
                Log in
              </button>
            </p>
          )}
        </div>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <Suspense
        fallback={
          <div className="flex min-h-[50vh] items-center justify-center">
            <p className="font-secondary text-ink/70">Loading...</p>
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
