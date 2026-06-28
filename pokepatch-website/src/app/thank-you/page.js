import Link from "next/link";
import SectionHeading from "@/components/SectionHeading";

export default function ThankYouPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="animate-fade-up">
        <SectionHeading subtitle="Thank you for your submission to PokePatch: Card Restoration!">
          You&apos;re all set!
        </SectionHeading>
      </div>

      <div className="pixel-border animate-fade-up space-y-5 rounded-2xl bg-white/60 p-8 text-center [animation-delay:150ms]">
        <p className="font-secondary text-ink/80">
          We&apos;ve received your restoration request and will review your cards
          shortly. You&apos;ll receive a quote within 1 business day using the
          contact information you provided.
        </p>
        <p className="font-secondary font-semibold text-ink">
          We look forward to helping bring your cards back to life!
        </p>

        <div className="pt-2">
          <Link
            href="/"
            className="inline-block rounded-full bg-blush px-6 py-3 font-bold text-ink shadow-cozy transition-all duration-200 ease-out active:translate-y-0.5 active:shadow-cozy-sm sm:hover:-translate-y-1 sm:hover:bg-blush/80 sm:hover:shadow-[0_10px_0_0_rgba(74,63,85,0.2)]"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
