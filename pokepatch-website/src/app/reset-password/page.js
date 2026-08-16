"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Button from "@/components/Button";
import LoadingSpinner from "@/components/LoadingSpinner";
import SectionHeading from "@/components/SectionHeading";
import { useAuth } from "@/contexts/AuthContext";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { fieldClassName } from "@/lib/formStyles";

const MIN_PASSWORD_LENGTH = 6;

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerAuthEnabled = isCustomerAuthEnabled();
  const { updatePassword } = useAuth();

  const tokenHash = searchParams.get("token_hash") || "";
  const verifyStartedRef = useRef(false);

  // idle → checking the recovery link | ready | saving | done | invalid
  const [status, setStatus] = useState("idle");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    if (!customerAuthEnabled) {
      router.replace("/");
    }
  }, [customerAuthEnabled, router]);

  // Two ways in:
  //   1. token_hash in the query string — the recovery email links here on our
  //      own domain, and we redeem the token via the API (see /verify-email for
  //      why the link doesn't point at the Supabase host).
  //   2. a session already parsed out of the URL fragment by supabase-js, for
  //      any older-style recovery link still in someone's inbox.
  useEffect(() => {
    if (!customerAuthEnabled || !supabase) return undefined;

    let active = true;

    if (tokenHash) {
      if (!verifyStartedRef.current) {
        verifyStartedRef.current = true;
        supabase.auth
          .verifyOtp({ token_hash: tokenHash, type: "recovery" })
          .then(({ error: verifyError }) => {
            if (!active) return;
            setStatus(verifyError ? "invalid" : "ready");
          });
      }
      return () => {
        active = false;
      };
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      setStatus(session ? "ready" : "invalid");
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session) setStatus((prev) => (prev === "invalid" ? "ready" : prev));
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [customerAuthEnabled, tokenHash]);

  if (!customerAuthEnabled) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const errors = {};
    if (password.length < MIN_PASSWORD_LENGTH) errors.password = true;
    if (password !== confirmPassword) errors.confirmPassword = true;
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setStatus("saving");

    try {
      await updatePassword(password);
      setStatus("done");
      router.push("/my-orders");
    } catch (err) {
      setStatus("ready");
      setError(err.message || "Couldn't update your password. Please try again.");
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-16">
      <div className="animate-fade-up">
        <SectionHeading
          note="Password"
          subtitle="Pick a new password for your account."
        >
          Set a new password
        </SectionHeading>
      </div>

      <div className="marketing-panel animate-fade-up space-y-6 p-6 [animation-delay:150ms]">
        {!isSupabaseConfigured && (
          <p className="rounded-2xl border-2 border-peach bg-peach/30 px-4 py-3 text-sm text-ink/80">
            Authentication is not configured.
          </p>
        )}

        {status === "idle" && (
          <p className="text-sm text-ink/70">Checking your reset link…</p>
        )}

        {status === "invalid" && (
          <div className="space-y-3">
            <p className="rounded-2xl border-2 border-error bg-error/15 px-4 py-3 text-sm font-semibold text-ink">
              This reset link is invalid or has expired.
            </p>
            <p className="text-sm text-ink/70">
              <Link
                href="/login"
                className="font-semibold text-ink hover:underline"
              >
                Request a new one
              </Link>{" "}
              from the log in page.
            </p>
          </div>
        )}

        {(status === "ready" || status === "saving" || status === "done") && (
          <>
            {error && (
              <p className="rounded-2xl border-2 border-error bg-error/15 px-4 py-3 text-sm font-semibold text-ink">
                {error}
              </p>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="new_password"
                  className="mb-1 block text-sm font-bold text-ink"
                >
                  New password <span className="text-error">*</span>
                </label>
                <input
                  id="new_password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, password: false }));
                  }}
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                  className={fieldClassName(fieldErrors.password)}
                  disabled={status !== "ready"}
                  required
                />
                {fieldErrors.password && (
                  <p className="mt-1 text-sm text-error">
                    Password must be at least {MIN_PASSWORD_LENGTH} characters
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="confirm_new_password"
                  className="mb-1 block text-sm font-bold text-ink"
                >
                  Confirm new password <span className="text-error">*</span>
                </label>
                <input
                  id="confirm_new_password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setFieldErrors((prev) => ({
                      ...prev,
                      confirmPassword: false,
                    }));
                  }}
                  placeholder="Confirm your new password"
                  className={fieldClassName(fieldErrors.confirmPassword)}
                  disabled={status !== "ready"}
                  required
                />
                {fieldErrors.confirmPassword && (
                  <p className="mt-1 text-sm text-error">
                    Passwords do not match
                  </p>
                )}
              </div>

              <Button
                type="submit"
                fullWidth
                disabled={status !== "ready" || !isSupabaseConfigured}
              >
                {status === "ready" ? (
                  "Save new password"
                ) : (
                  <span className="inline-block animate-soft-bounce">
                    Saving...
                  </span>
                )}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <LoadingSpinner />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
