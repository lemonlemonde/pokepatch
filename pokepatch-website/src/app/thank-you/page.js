"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Button from "@/components/Button";
import SectionHeading from "@/components/SectionHeading";
import { useAuth } from "@/contexts/AuthContext";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import {
  isExistingAccountSignup,
  sendExistingAccountNotice,
} from "@/lib/accountNotice";
import { fieldClassName } from "@/lib/formStyles";

export default function ThankYouPage() {
  return (
    <Suspense>
      <ThankYouContent />
    </Suspense>
  );
}

function ThankYouContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderNumber = searchParams.get("order");
  const customerAuthEnabled = isCustomerAuthEnabled();
  const { user, signUp } = useAuth();
  const [showAccountCreation, setShowAccountCreation] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  // If already logged in, don't show account creation
  useEffect(() => {
    if (user) {
      setShowAccountCreation(false);
    }
  }, [user]);

  // Pre-fill from the order they just submitted so the account links up and
  // their entered name + contacts get saved to the new profile.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("pokepatch_pending_profile");
      if (!raw) return;
      const pending = JSON.parse(raw);
      if (pending?.email) setEmail(pending.email);
      if (pending?.first_name) setFirstName(pending.first_name);
      if (pending?.last_name) setLastName(pending.last_name);
    } catch {
      // Ignore storage/parse errors; fields can be entered manually.
    }
  }, []);

  const validateForm = () => {
    const errors = {};

    if (!firstName.trim()) {
      errors.firstName = true;
    }
    if (!lastName.trim()) {
      errors.lastName = true;
    }

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
    setNotice("");

    if (!validateForm()) {
      setError("Please check the form for errors.");
      return;
    }

    setLoading(true);

    try {
      const data = await signUp(email, password, firstName, lastName);

      if (isExistingAccountSignup(data)) {
        // Supabase silently no-ops signUp for an already-registered email
        // instead of erroring (anti-enumeration). Send a real notice email
        // so the customer knows to log in instead of waiting on a
        // confirmation email that will never come.
        sendExistingAccountNotice(email);
        setNotice(
          "An account with that email already exists. We've emailed a reminder."
        );
        return;
      }

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
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="animate-fade-up">
        <SectionHeading
          note="Quote received"
          subtitle="Thank you — we got your submission and will follow up soon."
        >
          You&apos;re all set
        </SectionHeading>
      </div>

      <div className="marketing-panel animate-fade-up space-y-5 p-8 text-center [animation-delay:150ms]">
        {orderNumber && (
          <p className="text-lg font-bold text-ink">
            Order #{orderNumber}
          </p>
        )}
        <p className="text-ink/80">
          We&apos;ve received your restoration request and will review your cards
          shortly. A confirmation email is on its way — we&apos;ll reach out to you
          soon with a quote, usually within about 2 hours.
        </p>
        <p className="font-semibold text-ink">
          We look forward to helping bring your cards back to life!
        </p>

        {customerAuthEnabled &&
          !user &&
          isSupabaseConfigured &&
          !showAccountCreation && (
          <div className="space-y-3 border-t border-ink/10 pt-5">
            <p className="text-sm font-semibold text-ink">
              Want to track your order online?
            </p>
            <p className="text-sm text-ink/70">
              Create an account to view order updates and photos as we work on your
              cards.
            </p>
            <Button onClick={() => setShowAccountCreation(true)}>
              Create account
            </Button>
          </div>
        )}

        {customerAuthEnabled && showAccountCreation && !user && (
          <div className="space-y-4 border-t border-ink/10 pt-5 text-left">
            <h3 className="text-center text-lg font-bold text-ink">
              Create your account
            </h3>

            {error && (
              <p className="rounded-2xl border-2 border-error bg-error/15 px-4 py-3 text-sm font-semibold text-ink">
                {error}
              </p>
            )}

            {notice && (
              <p className="rounded-2xl border-2 border-lavender bg-lavender/20 px-4 py-3 text-sm font-semibold text-ink">
                {notice}{" "}
                <Link
                  href="/login"
                  className="font-bold text-ink hover:underline"
                >
                  Log in
                </Link>
              </p>
            )}

            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div>
                <label htmlFor="first_name" className="mb-1 block text-sm font-bold text-ink">
                  First name <span className="text-error">*</span>
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
                  Last name <span className="text-error">*</span>
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

              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-bold text-ink">
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
                  placeholder="Use the same email from your order"
                  className={fieldClassName(fieldErrors.email)}
                  disabled={loading}
                  required
                />
                {fieldErrors.email && (
                  <p className="mt-1 text-sm text-error">
                    Please enter a valid email address
                  </p>
                )}
                <p className="mt-1 text-xs text-ink/60">
                  Use the same email you provided in your contact info to automatically
                  link this order.
                </p>
              </div>

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
                  placeholder="At least 6 characters"
                  className={fieldClassName(fieldErrors.password)}
                  disabled={loading}
                  required
                />
                {fieldErrors.password && (
                  <p className="mt-1 text-sm text-error">
                    Password must be at least 6 characters
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="confirm-password"
                  className="mb-1 block text-sm font-bold text-ink"
                >
                  Confirm Password <span className="text-error">*</span>
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

              <div>
                <Button type="submit" fullWidth disabled={loading}>
                  {loading ? (
                    <span className="inline-block animate-soft-bounce">
                      Creating account...
                    </span>
                  ) : (
                    "Create account"
                  )}
                </Button>
              </div>
            </form>
          </div>
        )}

        {customerAuthEnabled && user && (
          <div className="space-y-3 border-t border-ink/10 pt-5">
            <p className="text-sm font-semibold text-ink">
              Your order has been linked to your account!
            </p>
            <Button href="/my-orders">View my orders</Button>
          </div>
        )}

        <div className="pt-2">
          <Button href="/" variant="secondary">
            Back to home
          </Button>
        </div>
      </div>
    </div>
  );
}
