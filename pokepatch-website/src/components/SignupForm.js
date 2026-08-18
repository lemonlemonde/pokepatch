"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Button from "@/components/Button";
import { useAuth } from "@/contexts/AuthContext";
import {
  isExistingAccountSignup,
  sendExistingAccountNotice,
} from "@/lib/accountNotice";
import { fieldClassName } from "@/lib/formStyles";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

/**
 * Shared create-account form for /login (signup mode) and /thank-you.
 */
export default function SignupForm({
  initialFirstName = "",
  initialLastName = "",
  initialEmail = "",
  emailPlaceholder = "you@example.com",
  existingAccountMessage = "An account with that email already exists. We've emailed a reminder to log in — or just log in below.",
  loginHref = "/login?redirect=/my-orders",
  showLoginLinkInNotice = true,
  footer = null,
  disabled = false,
}) {
  const router = useRouter();
  const { signUp } = useAuth();
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const validateForm = () => {
    const errors = {};

    if (!firstName.trim()) errors.firstName = true;
    if (!lastName.trim()) errors.lastName = true;

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
      const data = await signUp(email, password, firstName, lastName);

      if (isExistingAccountSignup(data)) {
        sendExistingAccountNotice(email);
        setNotice(existingAccountMessage);
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

  const busy = loading || disabled;

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-2xl border-2 border-error bg-error/15 px-4 py-3 text-sm font-semibold text-ink">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="rounded-2xl border-2 border-lavender bg-lavender/20 px-4 py-3 text-sm font-semibold text-ink">
          {notice}
          {showLoginLinkInNotice ? (
            <>
              {" "}
              <Link
                href={loginHref}
                className="font-bold text-ink hover:underline"
              >
                Log in
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="signup_first_name"
            className="mb-1 block text-sm font-bold text-ink"
          >
            First name <span className="text-error">*</span>
          </label>
          <input
            id="signup_first_name"
            type="text"
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              setFieldErrors((prev) => ({ ...prev, firstName: false }));
            }}
            placeholder="First name"
            className={fieldClassName(fieldErrors.firstName)}
            disabled={busy}
            required
          />
        </div>

        <div>
          <label
            htmlFor="signup_last_name"
            className="mb-1 block text-sm font-bold text-ink"
          >
            Last name <span className="text-error">*</span>
          </label>
          <input
            id="signup_last_name"
            type="text"
            value={lastName}
            onChange={(e) => {
              setLastName(e.target.value);
              setFieldErrors((prev) => ({ ...prev, lastName: false }));
            }}
            placeholder="Last name"
            className={fieldClassName(fieldErrors.lastName)}
            disabled={busy}
            required
          />
        </div>

        <div>
          <label
            htmlFor="signup_email"
            className="mb-1 block text-sm font-bold text-ink"
          >
            Email <span className="text-error">*</span>
          </label>
          <input
            id="signup_email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldErrors((prev) => ({ ...prev, email: false }));
            }}
            placeholder={emailPlaceholder}
            className={fieldClassName(fieldErrors.email)}
            disabled={busy}
            required
          />
          {fieldErrors.email ? (
            <p className="mt-1 text-sm text-error">
              Please enter a valid email address
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="signup_password"
            className="mb-1 block text-sm font-bold text-ink"
          >
            Password <span className="text-error">*</span>
          </label>
          <input
            id="signup_password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setFieldErrors((prev) => ({ ...prev, password: false }));
            }}
            placeholder="At least 6 characters"
            className={fieldClassName(fieldErrors.password)}
            disabled={busy}
            required
          />
          {fieldErrors.password ? (
            <p className="mt-1 text-sm text-error">
              Password must be at least 6 characters
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="signup_confirm_password"
            className="mb-1 block text-sm font-bold text-ink"
          >
            Confirm Password <span className="text-error">*</span>
          </label>
          <input
            id="signup_confirm_password"
            type="password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setFieldErrors((prev) => ({ ...prev, confirmPassword: false }));
            }}
            placeholder="Confirm your password"
            className={fieldClassName(fieldErrors.confirmPassword)}
            disabled={busy}
            required
          />
          {fieldErrors.confirmPassword ? (
            <p className="mt-1 text-sm text-error">Passwords do not match</p>
          ) : null}
        </div>

        <Button
          type="submit"
          fullWidth
          disabled={busy || !isSupabaseConfigured}
        >
          {loading ? (
            <span className="inline-block animate-soft-bounce">
              Creating account...
            </span>
          ) : (
            "Create account"
          )}
        </Button>
      </form>

      {footer}
    </div>
  );
}
