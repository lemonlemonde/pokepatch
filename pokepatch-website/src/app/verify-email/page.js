"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import SectionHeading from "@/components/SectionHeading";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";

const RESEND_COOLDOWN_SECONDS = 60;

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";

  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleResend = async () => {
    if (!supabase || !email || cooldown > 0) return;

    setStatus("sending");
    setError("");

    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email,
      });
      if (resendError) throw resendError;
      setStatus("sent");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setStatus("error");
      setError(err.message || "Couldn't resend the email. Please try again.");
    }
  };

  return (
    <>
      <div className="animate-fade-up">
        <SectionHeading subtitle="One quick step before you can log in.">
          Confirm your email
        </SectionHeading>
      </div>

      <div className="pixel-border animate-fade-up space-y-6 rounded-2xl bg-cream/60 p-6 text-center [animation-delay:150ms]">
        <p className="font-secondary text-ink/80">
          We sent a confirmation link to{" "}
          {email ? (
            <span className="font-semibold text-ink">{email}</span>
          ) : (
            "your email address"
          )}
          . Click the link in that email to activate your account, then come back
          to log in.
        </p>

        <p className="font-secondary text-sm text-ink/60">
          Can&apos;t find it? Check your spam or promotions folder.
        </p>

        {status === "sent" && (
          <p className="rounded-2xl border-2 border-mint bg-mint/40 px-4 py-3 text-sm font-semibold text-ink">
            Confirmation email sent. Please check your inbox.
          </p>
        )}

        {status === "error" && (
          <p className="rounded-2xl border-2 border-berry bg-berry/20 px-4 py-3 text-sm font-semibold text-ink">
            {error}
          </p>
        )}

        {isSupabaseConfigured && email && (
          <button
            onClick={handleResend}
            disabled={status === "sending" || cooldown > 0}
            className="w-full rounded-full bg-lavender px-6 py-3 font-bold text-night shadow-cozy transition-all duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-0.5 active:shadow-cozy-sm sm:hover:-translate-y-1 sm:hover:bg-lavender/80 sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)]"
          >
            {status === "sending" ? (
              <span className="inline-block animate-soft-bounce">Sending...</span>
            ) : cooldown > 0 ? (
              `Resend email (${cooldown}s)`
            ) : (
              "Resend confirmation email"
            )}
          </button>
        )}

        <div className="border-t border-ink/10 pt-4">
          <Link
            href="/login"
            className="font-secondary text-sm font-semibold text-blush hover:underline"
          >
            Back to log in
          </Link>
        </div>
      </div>
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <Suspense
        fallback={
          <div className="flex min-h-[50vh] items-center justify-center">
            <p className="font-secondary text-ink/70">Loading...</p>
          </div>
        }
      >
        <VerifyEmailContent />
      </Suspense>
    </div>
  );
}
