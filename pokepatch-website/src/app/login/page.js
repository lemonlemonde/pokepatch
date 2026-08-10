"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import Button from "@/components/Button";
import LoadingSpinner from "@/components/LoadingSpinner";
import SectionHeading from "@/components/SectionHeading";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import {
  isExistingAccountSignup,
  sendExistingAccountNotice,
} from "@/lib/accountNotice";

import { fieldClassName } from "@/lib/formStyles";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/my-orders";
  const customerAuthEnabled = isCustomerAuthEnabled();
  const { signIn, signUp, resetPassword, user } = useAuth();

  // "login" | "signup" | "forgot"
  const [mode, setMode] = useState("login");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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

    if (mode === "signup" && !firstName.trim()) {
      errors.firstName = true;
    }
    if (mode === "signup" && !lastName.trim()) {
      errors.lastName = true;
    }

    if (!email.trim()) {
      errors.email = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = true;
    }

    if (mode !== "forgot") {
      if (!password) {
        errors.password = true;
      } else if (mode === "signup" && password.length < 6) {
        errors.password = true;
      }
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
        // Deliberately the same message whether or not the address is
        // registered, so this can't be used to find out who has an account.
        setNotice(
          "If that email has an account, we've sent a link to reset the password. Check your inbox (and your spam folder)."
        );
        return;
      }

      if (mode === "login") {
        await signIn(email, password);
        router.push(redirectTo);
      } else {
        const data = await signUp(email, password, firstName, lastName);

        if (isExistingAccountSignup(data)) {
          // Supabase silently no-ops signUp for an already-registered email
          // instead of erroring (anti-enumeration). Send a real notice email
          // so the customer knows to log in instead of waiting on a
          // confirmation email that will never come.
          sendExistingAccountNotice(email);
          setNotice(
            "An account with that email already exists. We've emailed a reminder to log in — or just log in below."
          );
          return;
        }

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
          <p className="rounded-2xl border-2 border-error bg-error/15 px-4 py-3 text-sm font-semibold text-ink">
            {error}
          </p>
        )}

        {notice && (
          <p className="rounded-2xl border-2 border-lavender bg-lavender/20 px-4 py-3 text-sm font-semibold text-ink">
            {notice}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <>
              <div>
                <label htmlFor="first_name" className="mb-1 block text-sm font-bold text-ink">
                  First name <span className="text-berry">*</span>
                </label>
                <input
                  id="first_name"
                  type="text"
                  value={firstName}
                  onChange={(e) => {
                    setFirstName(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, firstName: false }));
                  }}
                  placeholder="First name"
                  className={fieldClassName(fieldErrors.firstName)}
                  disabled={loading}
                  required
                />
              </div>

              <div>
                <label htmlFor="last_name" className="mb-1 block text-sm font-bold text-ink">
                  Last name <span className="text-berry">*</span>
                </label>
                <input
                  id="last_name"
                  type="text"
                  value={lastName}
                  onChange={(e) => {
                    setLastName(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, lastName: false }));
                  }}
                  placeholder="Last name"
                  className={fieldClassName(fieldErrors.lastName)}
                  disabled={loading}
                  required
                />
              </div>
            </>
          )}

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
              <p className="mt-1 text-sm text-error">
                Please enter a valid email address
              </p>
            )}
          </div>

          {mode !== "forgot" && (
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
              <p className="mt-1 text-sm text-error">
                Password must be at least 6 characters
              </p>
            )}
            {mode === "login" && (
              <p className="mt-2 text-right text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setMode("forgot");
                    setError("");
                    setNotice("");
                    setFieldErrors({});
                    setPassword("");
                  }}
                  className="font-semibold text-blush hover:underline"
                >
                  Forgot password?
                </button>
              </p>
            )}
          </div>
          )}

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
                <p className="mt-1 text-sm text-error">Passwords do not match</p>
              )}
            </div>
          )}

          <Button type="submit" fullWidth disabled={loading || !isSupabaseConfigured}>
            {loading ? (
              <span className="inline-block animate-soft-bounce">
                {mode === "login"
                  ? "Logging in..."
                  : mode === "signup"
                    ? "Creating account..."
                    : "Sending reset link..."}
              </span>
            ) : mode === "login" ? (
              "Log in"
            ) : mode === "signup" ? (
              "Create account"
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
                onClick={() => {
                  setMode("login");
                  setError("");
                  setNotice("");
                  setFieldErrors({});
                }}
                className="font-semibold text-blush hover:underline"
              >
                Back to log in
              </button>
            </p>
          ) : mode === "login" ? (
            <p className="text-sm text-ink/70">
              Don&apos;t have an account?{" "}
              <button
                onClick={() => {
                  setMode("signup");
                  setError("");
                  setNotice("");
                  setFieldErrors({});
                }}
                className="font-semibold text-blush hover:underline"
              >
                Sign up
              </button>
            </p>
          ) : (
            <p className="text-sm text-ink/70">
              Already have an account?{" "}
              <button
                onClick={() => {
                  setMode("login");
                  setError("");
                  setNotice("");
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
