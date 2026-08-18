"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Button from "@/components/Button";
import LoadingSpinner from "@/components/LoadingSpinner";
import SectionHeading from "@/components/SectionHeading";
import {
  getAuthEmailRedirectTo,
  isCustomerAuthEnabled,
} from "@/lib/customerAuth";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";

const RESEND_COOLDOWN_SECONDS = 60;

// Auth email types this page can redeem a token_hash for.
const CONFIRMABLE_TYPES = new Set(["signup", "email_change", "magiclink", "invite"]);

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  const customerAuthEnabled = isCustomerAuthEnabled();

  // Set when the customer arrives from a confirmation email. The link points at
  // this page rather than the Supabase API host so that every URL in the email
  // is on our own domain — mismatched link domains are a strong spam signal.
  const tokenHash = searchParams.get("token_hash") || "";
  const typeParam = searchParams.get("type") || "";
  const tokenType = CONFIRMABLE_TYPES.has(typeParam) ? typeParam : "signup";
  const verifyStartedRef = useRef(false);

  // idle | sending | sent | error | verifying | invalid
  const [status, setStatus] = useState(() => (tokenHash ? "verifying" : "idle"));
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!customerAuthEnabled) {
      router.replace("/");
    }
  }, [customerAuthEnabled, router]);

  // Redeem the token from the email. Supabase still does the verifying; the
  // only change is that it happens over an API call from our page instead of a
  // browser navigation to the Supabase host.
  useEffect(() => {
    if (!customerAuthEnabled || !supabase || !tokenHash) return;
    if (verifyStartedRef.current) return;
    verifyStartedRef.current = true;

    supabase.auth
      .verifyOtp({ token_hash: tokenHash, type: tokenType })
      .then(({ error: verifyError }) => {
        if (verifyError) {
          setStatus("invalid");
          setError(verifyError.message || "");
          return;
        }
        router.replace("/my-orders");
      });
  }, [customerAuthEnabled, tokenHash, tokenType, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (!customerAuthEnabled) {
    return null;
  }

  const handleResend = async () => {
    if (!supabase || !email || cooldown > 0) return;

    setStatus("sending");
    setError("");

    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: getAuthEmailRedirectTo("/my-orders"),
        },
      });
      if (resendError) throw resendError;
      setStatus("sent");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setStatus("error");
      setError(err.message || "Couldn't resend the email. Please try again.");
    }
  };

  // Arrived from the email link: nothing to do but redeem the token.
  if (status === "verifying") {
    return (
      <div className="animate-fade-up">
        <SectionHeading note="Email" subtitle="One moment.">
          Confirming your email
        </SectionHeading>
        <div className="marketing-panel mt-6 flex justify-center p-10">
          <LoadingSpinner />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="animate-fade-up">
        <SectionHeading
          note="Email"
          subtitle="One quick step before you can log in."
        >
          Confirm your email
        </SectionHeading>
      </div>

      <div className="marketing-panel animate-fade-up space-y-6 p-6 text-center [animation-delay:150ms]">
        {status === "invalid" ? (
          <>
            <p className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-ink">
              That confirmation link is invalid or has expired.
            </p>
            <p className="text-ink/80">
              Links are single use and time limited. Send yourself a fresh one
              below.
            </p>
          </>
        ) : (
          <>
            <p className="text-ink/80">
              We sent a confirmation link to{" "}
              {email ? (
                <span className="font-semibold text-ink">{email}</span>
              ) : (
                "your email address"
              )}
              . Click the link in that email to activate your account, then come
              back to log in.
            </p>

            <p className="text-sm text-ink/60">
              Can&apos;t find it? Check your spam or promotions folder.
            </p>
          </>
        )}

        {status === "sent" && (
          <p className="rounded-lg border border-mint/30 bg-mint/15 px-4 py-3 text-sm text-ink">
            Confirmation email sent. Please check your inbox.
          </p>
        )}

        {status === "error" && (
          <p className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-ink">
            {error}
          </p>
        )}

        {isSupabaseConfigured && email && (
          <Button
            fullWidth
            onClick={handleResend}
            disabled={status === "sending" || cooldown > 0}
          >
            {status === "sending" ? (
              <span className="inline-block animate-soft-bounce">Sending...</span>
            ) : cooldown > 0 ? (
              `Resend email (${cooldown}s)`
            ) : (
              "Resend confirmation email"
            )}
          </Button>
        )}

        <div className="border-t border-ink/10 pt-4">
          <Link
            href="/login"
            className="text-sm font-semibold text-ink hover:underline"
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
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-16">
      <Suspense
        fallback={
          <div className="flex min-h-[50vh] items-center justify-center">
            <LoadingSpinner />
          </div>
        }
      >
        <VerifyEmailContent />
      </Suspense>
    </div>
  );
}
