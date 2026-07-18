"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SectionHeading from "@/components/SectionHeading";
import { useAuth } from "@/contexts/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

function fieldClassName(invalid = false) {
  return invalid
    ? "w-full scroll-mt-24 rounded-xl border-2 border-berry bg-cream px-4 py-2 text-ink outline-none focus:border-berry"
    : "w-full scroll-mt-24 rounded-xl border-2 border-ink/15 bg-cream px-4 py-2 text-ink outline-none focus:border-blush";
}

export default function ThankYouPage() {
  const router = useRouter();
  const { user, signUp } = useAuth();
  const [showAccountCreation, setShowAccountCreation] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  // If already logged in, don't show account creation
  useEffect(() => {
    if (user) {
      setShowAccountCreation(false);
    }
  }, [user]);

  // Pre-fill the email from the order they just submitted so the account links
  // up and their entered contacts get saved to the new profile.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("pokepatch_pending_profile");
      if (!raw) return;
      const pending = JSON.parse(raw);
      if (pending?.email) setEmail(pending.email);
    } catch {
      // Ignore storage/parse errors; email can be entered manually.
    }
  }, []);

  const validateForm = () => {
    const errors = {};

    if (!email.trim()) {
      errors.email = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = true;
    }

    if (!password) {
      errors.password = true;
    } else if (password.length < 6) {
      errors.password = true;
    }

    if (password !== confirmPassword) {
      errors.confirmPassword = true;
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateAccount = async (e) => {
    e.preventDefault();
    setError("");

    if (!validateForm()) {
      setError("Please check the form for errors.");
      return;
    }

    setLoading(true);

    try {
      const data = await signUp(email, password);

      if (data.session) {
        router.push("/my-orders");
      } else {
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
      }
    } catch (err) {
      setError(err.message || "Failed to create account. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="animate-fade-up">
        <SectionHeading subtitle="Thank you for your submission to PokePatch: Card Restoration!">
          You&apos;re all set!
        </SectionHeading>
      </div>

      <div className="pixel-border animate-fade-up space-y-5 rounded-2xl bg-cream/60 p-8 text-center [animation-delay:150ms]">
        <p className="font-secondary text-ink/80">
          We&apos;ve received your restoration request and will review your cards
          shortly. You&apos;ll receive a quote within approximately 2 hours using the
          contact information you provided.
        </p>
        <p className="font-secondary font-semibold text-ink">
          We look forward to helping bring your cards back to life!
        </p>

        {!user && isSupabaseConfigured && !showAccountCreation && (
          <div className="space-y-3 border-t border-ink/10 pt-5">
            <p className="font-secondary text-sm font-semibold text-ink">
              Want to track your order online?
            </p>
            <p className="font-secondary text-sm text-ink/70">
              Create an account to view order updates and photos as we work on your
              cards.
            </p>
            <button
              onClick={() => setShowAccountCreation(true)}
              className="inline-block rounded-full bg-lavender px-6 py-3 font-bold text-night shadow-cozy transition-all duration-200 ease-out active:translate-y-0.5 active:shadow-cozy-sm sm:hover:-translate-y-1 sm:hover:bg-lavender/80 sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)]"
            >
              Create account
            </button>
          </div>
        )}

        {showAccountCreation && !user && (
          <div className="space-y-4 border-t border-ink/10 pt-5 text-left">
            <h3 className="text-center text-lg font-bold text-ink">
              Create your account
            </h3>

            {error && (
              <p className="rounded-2xl border-2 border-berry bg-berry/20 px-4 py-3 text-sm font-semibold text-ink">
                {error}
              </p>
            )}

            <form onSubmit={handleCreateAccount} className="space-y-4">
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
                  placeholder="Use the same email from your order"
                  className={fieldClassName(fieldErrors.email)}
                  disabled={loading}
                  required
                />
                {fieldErrors.email && (
                  <p className="mt-1 text-sm text-berry">
                    Please enter a valid email address
                  </p>
                )}
                <p className="mt-1 font-secondary text-xs text-ink/60">
                  Use the same email you provided in your contact info to automatically
                  link this order.
                </p>
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-1 block text-sm font-bold text-ink"
                >
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
                  placeholder="At least 6 characters"
                  className={fieldClassName(fieldErrors.password)}
                  disabled={loading}
                  required
                />
                {fieldErrors.password && (
                  <p className="mt-1 text-sm text-berry">
                    Password must be at least 6 characters
                  </p>
                )}
              </div>

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

              <div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-full bg-lavender px-6 py-3 font-bold text-night shadow-cozy transition-all duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-0.5 active:shadow-cozy-sm sm:hover:-translate-y-1 sm:hover:bg-lavender/80 sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)]"
                >
                  {loading ? (
                    <span className="inline-block animate-soft-bounce">
                      Creating account...
                    </span>
                  ) : (
                    "Create account"
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

        {user && (
          <div className="space-y-3 border-t border-ink/10 pt-5">
            <p className="font-secondary text-sm font-semibold text-ink">
              Your order has been linked to your account!
            </p>
            <Link
              href="/my-orders"
              className="inline-block rounded-full bg-lavender px-6 py-3 font-bold text-night shadow-cozy transition-all duration-200 ease-out active:translate-y-0.5 active:shadow-cozy-sm sm:hover:-translate-y-1 sm:hover:bg-lavender/80 sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)]"
            >
              View my orders
            </Link>
          </div>
        )}

        <div className="pt-2">
          <Link
            href="/"
            className="inline-block rounded-full bg-blush px-6 py-3 font-bold text-night shadow-cozy transition-all duration-200 ease-out active:translate-y-0.5 active:shadow-cozy-sm sm:hover:-translate-y-1 sm:hover:bg-blush/80 sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)]"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
