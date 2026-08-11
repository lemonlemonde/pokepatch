import Button from "@/components/Button";
import Hero from "@/components/marketing/Hero";
import MarketingPageShell from "@/components/marketing/MarketingPageShell";
import MarketingSectionHeading from "@/components/marketing/MarketingSectionHeading";
import ScrollReveal from "@/components/marketing/ScrollReveal";
import ServiceCard from "@/components/ServiceCard";
import ServiceModifiersCard from "@/components/ServiceModifiersCard";
import FaqItem from "@/components/FaqItem";
import FeaturedRestorations from "@/components/FeaturedRestorations";
import HomeStructuredData from "@/components/HomeStructuredData";
import QueueCount from "@/components/QueueCount";
import { marketingModifiers, marketingServices } from "@/lib/servicePricing";

const steps = [
  {
    title: "Request a quote",
    text: "Send photos of your cards and tell us what you'd like fixed. No commitment yet.",
  },
  {
    title: "Get your quote",
    text: "We look over the photos and reply — usually within 2 hours — with options and pricing.",
  },
  {
    title: "Send your cards",
    text: "Drop them off in North San Jose, or mail them in from anywhere in the US.",
  },
  {
    title: "Cards come home",
    text: "We restore them, share before-and-after photos, and return them the way they came.",
  },
];

const services = marketingServices();
const modifiers = marketingModifiers();

const faqs = [
  {
    question: "How do I send in my cards?",
    answer:
      "Fill out the quote form with details about your card, and what you'd like fixed for each one. You can opt for local drop-off (North San Jose) or shipping. We'll get in contact with you with a quote and discuss options on how to best restore your cards!",
  },
  {
    question: "What kinds of cards do you restore?",
    answer:
      "Trading cards of all kinds — Pokémon, One Piece, Sports, Magic, Yugioh, and more. If you're unsure, send a photo through the contact form and we'll let you know!",
  },
  {
    question: "How soon can I get a quote?",
    answer: "Turnaround time is less than 2 hours.",
  },
  {
    question: "How long does restoration take?",
    answer:
      "Anywhere from a few hours to 2 weeks, depending on the number of cards, restoration type, and any pickup or shipping logistics.",
  },
  {
    question: "Can whitening on cards be fixed?",
    answer:
      "No — whitening cannot be fixed, and the card will be marked as altered if graded.",
  },
  {
    question: "Is shipping covered?",
    answer:
      "Any shipping costs are not covered. Cards will be carefully re-packaged and sent back in the same packaging they were sent in.",
  },
  {
    question: "Do you offer before-and-after photos?",
    answer:
      "Yes! We document every restoration and share before-and-after photos. Check out our Gallery page for examples.",
  },
  {
    question: "How are high-value fees calculated?",
    answer:
      "We set each card's market price from the average of the last 3 recently sold eBay listings for a raw near mint copy. Cards valued $200–$499 add a 4% high-value handling fee; cards $500 and up add 8%. Cards under $200 have no high-value fee.",
  },
];

export default function Home() {
  return (
    <MarketingPageShell>
      <HomeStructuredData faqs={faqs} />
      <Hero />

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="marketing-section">
          <QueueCount variant="marketing" />
        </section>

        <section className="marketing-section">
          <MarketingSectionHeading note="Gallery">
            Lately on the bench
          </MarketingSectionHeading>
          <ScrollReveal>
            <FeaturedRestorations variant="marketing" />
          </ScrollReveal>
        </section>

        <section className="marketing-section">
          <MarketingSectionHeading note="Getting started">
            How it works
          </MarketingSectionHeading>
          <ol className="grid gap-12 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-14 lg:grid-cols-4 lg:gap-10">
            {steps.map((step, index) => (
              <ScrollReveal
                key={step.title}
                as="li"
                variant="dramatic"
                className="border-l border-ink/15 pl-5 sm:pl-6"
              >
                <span
                  className="block font-mono text-4xl font-light leading-none tracking-tight text-ink/[0.14] sm:text-5xl"
                  aria-hidden="true"
                >
                  0{index + 1}
                </span>
                <h3 className="mt-5 text-base font-medium text-ink sm:mt-6">
                  {step.title}
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-ink/60">
                  {step.text}
                </p>
              </ScrollReveal>
            ))}
          </ol>
        </section>

        <section className="marketing-section">
          <MarketingSectionHeading note="Pricing">
            What we fix
          </MarketingSectionHeading>
          <div className="grid gap-4 sm:grid-cols-2">
            {services.map((service) => (
              <ScrollReveal key={service.title}>
                <ServiceCard {...service} variant="marketing" />
              </ScrollReveal>
            ))}
            <ScrollReveal className="sm:col-span-2" variant="dramatic">
              <ServiceModifiersCard
                panels={modifiers}
                accent="mint"
                variant="marketing"
              />
            </ScrollReveal>
          </div>
        </section>

        <section className="marketing-section">
          <MarketingSectionHeading note="FAQ">
            Good to know
          </MarketingSectionHeading>
          <div>
            {faqs.map((faq) => (
              <ScrollReveal key={faq.question}>
                <FaqItem {...faq} variant="marketing" />
              </ScrollReveal>
            ))}
            <hr className="border-t border-ink/10" />
          </div>
        </section>

        <section className="marketing-section">
          <ScrollReveal variant="dramatic">
            <div className="rounded-lg border border-ink/10 px-5 py-12 text-center sm:px-10 sm:py-16 md:px-16 md:py-20">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink/40 sm:text-[11px] sm:tracking-[0.3em]">
                Start a quote
              </p>
              <h2 className="mx-auto mt-5 max-w-2xl text-[1.85rem] font-medium leading-tight tracking-[-0.03em] text-ink sm:mt-6 sm:text-4xl md:text-5xl lg:text-6xl">
                Ready to revive your cards?
              </h2>
              <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-ink/60 md:text-base">
                Send a few photos — we&apos;ll get back to you within 2 hours.
              </p>
              <div className="mt-8 sm:mt-10">
                <Button
                  href="/contact"
                  variant="marketing"
                  className="w-full min-h-12 text-center font-mono text-xs uppercase tracking-[0.18em] sm:w-auto"
                >
                  Get Free Quote
                </Button>
              </div>
            </div>
          </ScrollReveal>
        </section>
      </div>
    </MarketingPageShell>
  );
}
