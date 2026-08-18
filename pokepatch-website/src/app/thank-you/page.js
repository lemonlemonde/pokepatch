"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Button from "@/components/Button";
import SectionHeading from "@/components/SectionHeading";
import SignupForm from "@/components/SignupForm";
import { useAuth } from "@/contexts/AuthContext";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

function readPendingProfile() {
  if (typeof window === "undefined") {
    return { firstName: "", lastName: "", email: "" };
  }
  try {
    const raw = window.localStorage.getItem("pokepatch_pending_profile");
    if (!raw) return { firstName: "", lastName: "", email: "" };
    const pending = JSON.parse(raw);
    return {
      firstName: pending?.first_name ?? "",
      lastName: pending?.last_name ?? "",
      email: pending?.email ?? "",
    };
  } catch {
    return { firstName: "", lastName: "", email: "" };
  }
}

export default function ThankYouPage() {
  return (
    <Suspense>
      <ThankYouContent />
    </Suspense>
  );
}

function ThankYouContent() {
  const searchParams = useSearchParams();
  const orderNumber = searchParams.get("order");
  const customerAuthEnabled = isCustomerAuthEnabled();
  const { user } = useAuth();
  const [skippedAccount, setSkippedAccount] = useState(false);
  const [pendingProfile, setPendingProfile] = useState(null);

  const showGuestAccountPrompt =
    customerAuthEnabled && !user && isSupabaseConfigured && !skippedAccount;

  useEffect(() => {
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      setPendingProfile(readPendingProfile());
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="animate-fade-up">
        <SectionHeading
          note="Quote received"
          subtitle={
            showGuestAccountPrompt
              ? "Your request is in — create an account so you can track updates and photos here."
              : "Thank you — we got your submission and will follow up soon."
          }
        >
          {showGuestAccountPrompt
            ? "Create an account to track your order"
            : "You're all set"}
        </SectionHeading>
      </div>

      <div className="marketing-panel animate-fade-up space-y-5 p-8 text-center [animation-delay:150ms]">
        {orderNumber && (
          <p className="text-lg font-bold text-ink">Order #{orderNumber}</p>
        )}
        <p className="text-ink/80">
          We&apos;ve received your restoration request and will review your cards
          shortly. A confirmation email is on its way — we&apos;ll reach out to you
          soon with a quote, usually within 1 day.
        </p>

        {showGuestAccountPrompt && pendingProfile && (
          <div className="space-y-4 border-t border-ink/10 pt-5 text-left">
            <p className="text-center text-sm text-ink/70">
              Use the same email from your order so it links automatically.
              Already have an account?{" "}
              <Link
                href="/login?redirect=/my-orders"
                className="font-bold text-ink hover:underline"
              >
                Log in
              </Link>
            </p>

            <SignupForm
              key={`${pendingProfile.email}|${pendingProfile.firstName}|${pendingProfile.lastName}`}
              initialFirstName={pendingProfile.firstName}
              initialLastName={pendingProfile.lastName}
              initialEmail={pendingProfile.email}
              emailPlaceholder="Same email as your order"
              existingAccountMessage="An account with that email already exists. We've emailed a reminder."
              footer={
                <p className="pt-1 text-center">
                  <button
                    type="button"
                    onClick={() => setSkippedAccount(true)}
                    className="text-sm font-semibold text-ink/50 underline-offset-2 hover:text-ink/70 hover:underline"
                  >
                    Skip for now
                  </button>
                </p>
              }
            />
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

        {customerAuthEnabled && !user && skippedAccount && (
          <p className="border-t border-ink/10 pt-5 text-sm text-ink/70">
            You can still create an account later from your confirmation email
            to track this order.
          </p>
        )}

        {!showGuestAccountPrompt && (
          <div className="pt-2">
            <Button href="/" variant="secondary">
              Back to home
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
