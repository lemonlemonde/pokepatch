import SectionHeading from "@/components/SectionHeading";
import SocialLinks from "@/components/SocialLinks";
import QuoteForm from "@/components/QuoteForm";

export const metadata = {
  title: "Get Free Quote",
  description:
    "Send photos of your damaged trading cards and get a restoration quote within 2 hours. Local Bay Area drop-off or nationwide mail-in.",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-12 md:py-16">
      <SectionHeading
        as="h1"
        note="Quote"
        subtitle="Send photos of your cards and tell us what you'd like fixed. We usually reply within 2 hours."
      >
        Get a free quote
      </SectionHeading>

      <SocialLinks className="mb-8" />

      <QuoteForm />
    </div>
  );
}
