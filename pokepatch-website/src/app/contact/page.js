import SectionHeading from "@/components/SectionHeading";
import QuoteForm from "@/components/QuoteForm";

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="animate-fade-up">
        <SectionHeading subtitle="Fill out the form below and we'll get back to you!">
          Contact
        </SectionHeading>
      </div>

      <QuoteForm />
    </div>
  );
}
