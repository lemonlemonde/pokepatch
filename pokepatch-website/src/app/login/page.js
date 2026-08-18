"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import Button from "@/components/Button";
import LoadingSpinner from "@/components/LoadingSpinner";
import SectionHeading from "@/components/SectionHeading";
import SignupForm from "@/components/SignupForm";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import { fieldClassName } from "@/lib/formStyles";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/my-orders";
  const customerAuthEnabled = isCustomerAuthEnabled();
  const { signIn, resetPassword, user } = useAuth();

  // "login" | "signup" | "forgot"
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    if (!customerAuthEnabled) {
      router.replace("/");
    }
  }, [customerAuthEnabled, router]);

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

    if (mode !== "forgot") {
      if (!password) {
        errors.password = true;
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");

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
      if (mode === "forgot") {
        await resetPassword(email);
        setNotice(
          "If that email has an account, we've sent a link to reset the password. Check your inbox (and your spam folder)."
        );
        return;
      }

      await signIn(email, password);
      router.push(redirectTo);
    } catch (err) {
      setError(err.message || "An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  function switchMode(next) {
    setMode(next);
    setError("");
    setNotice("");
    setFieldErrors({});
    if (next !== "login") setPassword("");
  }

  return (
    <>
      <div className="animate-fade-up">
        <SectionHeading
          note={
            mode === "login"
              ? "Account"
              : mode === "signup"
                ? "New account"
                : "Password"
          }
          subtitle={
            mode === "login"
              ? "Welcome back."
              : mode === "signup"
                ? "Create an account to track your orders."
                : "We'll email you a link to set a new one."
          }
        >
          {mode === "login"
            ? "Log in"
            : mode === "signup"
              ? "Sign up"
              : "Reset password"}
        </SectionHeading>
      </div>

      <div className="marketing-panel animate-fade-up space-y-6 p-6 [animation-delay:150ms]">
        {!isSupabaseConfigured && (
          <p className="rounded-lg border border-peach/30 bg-peach/15 px-4 py-3 text-sm text-ink/80">
            Authentication is not configured. Please add{" "}
            <code className="rounded bg-night/50 px-1">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
            and{" "}
            <code className="rounded bg-night/50 px-1">
              NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
            </code>{" "}
            to <code className="rounded bg-night/50 px-1">.env.local</code>.
          </p>
        )}

        {mode === "signup" ? (
          <SignupForm
            key="signup"
            initialEmail={email}
            loginHref={`/login?redirect=${encodeURIComponent(redirectTo)}`}
            showLoginLinkInNotice={false}
            existingAccountMessage="An account with that email already exists. We've emailed a reminder — or log in below."
            disabled={!isSupabaseConfigured}
            footer={
              <div className="border-t border-ink/10 pt-4 text-center">
                <p className="text-sm text-ink/70">
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("login")}
                    className="font-semibold text-ink hover:underline"
                  >
                    Log in
                  </button>
                </p>
              </div>
            }
          />
        ) : (
          <>
            {error && (
              <p className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-ink">
                {error}
              </p>
            )}

            {notice && (
              <p className="rounded-lg border border-lavender/30 bg-lavender/10 px-4 py-3 text-sm text-ink">
                {notice}
              </p>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1 block text-sm font-bold text-ink"
                >
                  Email <span className="text-error">*</span>
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
                  <p className="mt-1 text-sm text-error">
                    Please enter a valid email address
                  </p>
                )}
              </div>

              {mode !== "forgot" && (
                <div>
                  <label
                    htmlFor="password"
                    className="mb-1 block text-sm font-bold text-ink"
                  >
                    Password <span className="text-error">*</span>
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setFieldErrors((prev) => ({ ...prev, password: false }));
                    }}
                    placeholder="Your password"
                    className={fieldClassName(fieldErrors.password)}
                    disabled={loading}
                    required
                  />
                  <p className="mt-2 text-right text-sm">
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="font-semibold text-ink hover:underline"
                    >
                      Forgot password?
                    </button>
                  </p>
                </div>
              )}

              <Button
                type="submit"
                fullWidth
                disabled={loading || !isSupabaseConfigured}
              >
                {loading ? (
                  <span className="inline-block animate-soft-bounce">
                    {mode === "login"
                      ? "Logging in..."
                      : "Sending reset link..."}
                  </span>
                ) : mode === "login" ? (
                  "Log in"
                ) : (
                  "Send reset link"
                )}
              </Button>
            </form>

            <div className="border-t border-ink/10 pt-4 text-center">
              {mode === "forgot" ? (
                <p className="text-sm text-ink/70">
                  Remembered it?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("login")}
                    className="font-semibold text-ink hover:underline"
                  >
                    Back to log in
                  </button>
                </p>
              ) : (
                <p className="text-sm text-ink/70">
                  Don&apos;t have an account?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("signup")}
                    className="font-semibold text-ink hover:underline"
                  >
                    Sign up
                  </button>
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-16">
      <Suspense
        fallback={
          <div className="flex min-h-[50vh] items-center justify-center">
            <LoadingSpinner />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
