"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  overlayFadeClassName,
  useOverlayEnterExit,
} from "@/components/ExpandReveal";

// Shown when a visitor submits the quote form with an email that already has an
// account. Logging in happens right here rather than on /login so the form —
// including the card photos, which are in-memory File objects that cannot
// survive a navigation — stays mounted underneath.
//
// The caller mounts this only while the prompt is open, so each open starts
// with a clean password field.
export default function QuoteLoginDialog({ email, onLoggedIn, onGuest }) {
  const { signIn, resetPassword } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const { visible, fadeThen } = useOverlayEnterExit();

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape" && !busy) fadeThen(onGuest);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onGuest, fadeThen]);

  async function handleLogin(event) {
    event.preventDefault();
    if (busy) return;

    if (password === "") {
      setError("Please enter your password.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      await signIn(email, password);
      onLoggedIn();
    } catch (err) {
      setError(err?.message || "Couldn't log in. Please try again.");
      setBusy(false);
    }
  }

  // Sends the recovery email without leaving the form. The dialog stays open so
  // the visitor can come back and log in once they've reset, or bail out to
  // guest — navigating to /login would drop the staged card photos.
  async function handleForgotPassword() {
    if (busy) return;

    setBusy(true);
    setError("");
    setNotice("");

    try {
      await resetPassword(email);
      setNotice(
        "Sent — check your inbox (and your spam folder) for a link to reset your password. Your order is still here when you get back."
      );
    } catch (err) {
      setError(err?.message || "Couldn't send the reset link. Please try again.");
    }
    setBusy(false);
  }

  const dialog = (
    <div
      className={`fixed inset-0 z-[300] flex items-center justify-center bg-night/70 px-4 py-6 ${overlayFadeClassName(visible)}`}
      role="presentation"
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="quote-login-title"
        aria-describedby="quote-login-body"
        onSubmit={handleLogin}
        className="w-full max-w-md overflow-hidden rounded-xl border border-ink/15 bg-[#120c1f] shadow-2xl"
      >
        <div className="border-b border-ink/10 px-5 py-4">
          <h2 id="quote-login-title" className="text-xl font-bold text-ink">
            You already have an account
          </h2>
          <p id="quote-login-body" className="mt-1.5 text-sm text-ink/70">
            <span className="font-semibold text-ink">{email}</span>{" "}
            is already registered. Log in and we&apos;ll attach this order to
            your account —
            your cards and photos stay right where they are.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div>
            <label
              htmlFor="quote_login_password"
              className="mb-1 block text-sm font-bold text-ink"
            >
              Password
            </label>
            <input
              id="quote_login_password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
                setNotice("");
              }}
              disabled={busy}
              className="w-full rounded-lg border border-ink/15 bg-ink/[0.03] px-4 py-2.5 text-ink outline-none focus:border-ink/40 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p className="mt-2 text-right text-sm">
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={busy}
                className="font-semibold text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                Forgot password?
              </button>
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm font-semibold text-error">
              {error}
            </p>
          )}

          {notice && (
            <p role="status" className="text-sm font-semibold text-ink/80">
              {notice}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => fadeThen(onGuest)}
            disabled={busy}
            className="rounded-xl border-2 border-ink/20 px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            Continue as guest
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-night shadow-cozy transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Logging in…" : "Log in"}
          </button>
        </div>
      </form>
    </div>
  );

  // Portal to <body> — the quote form sits inside an `animate-fade-up`
  // ancestor, and a CSS transform on an ancestor makes `fixed` cover that
  // ancestor's box instead of the viewport. UnsavedChangesDialog and
  // MediaLightbox portal for the same reason.
  if (typeof document === "undefined") return null;
  return createPortal(dialog, document.body);
}
