import SectionHeading from "@/components/SectionHeading";

const FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSe9rPl1Rt2pFJb7oGfPpCWn_USTAs1nGFwVmtI1YQY-x-GCsg/viewform";

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="animate-fade-up">
        <SectionHeading subtitle="Fill out the form below and we'll get back to you!">
          Contact
        </SectionHeading>
      </div>

      <div className="animate-fade-up overflow-hidden rounded-2xl bg-white/60 pixel-border [animation-delay:150ms]">
        <iframe
          src={`${FORM_URL}?embedded=true`}
          title="PokePatch Card Restoration form"
          className="h-[80vh] w-full"
          loading="lazy"
        >
          Loading…
        </iframe>
      </div>

      <p className="mt-4 animate-fade-up text-center font-secondary text-sm text-ink/60 [animation-delay:300ms]">
        Trouble seeing the form?{" "}
        <a
          href={FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-ink underline decoration-blush decoration-2 underline-offset-2 hover:text-ink/80"
        >
          Open it in a new tab
        </a>
        .
      </p>
    </div>
  );
}
